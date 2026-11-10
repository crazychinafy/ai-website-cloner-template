// P4：数据一致性验证（§11）—— 独立脚本，分别读取 StaticSnapshotRepository 与 MySqlRepository 并对比全部 13 类数据
// 用法：
//   npm run admin:import:verify [-- --json=docs/P4-verify-report.json]
// 显式规范化规则（不通过忽略差异来“对齐”）：
//   - ID：两侧一律十进制字符串（BIGINT 精度保护；17/18 位全量比对）
//   - 日期：两侧 DTO 均为规范形 "YYYY-MM-DDTHH:MM:SS"（仓库层已做 T 分隔/秒精度规范化）→ 直接字符串等值
//   - 计数（click/like/view）：字符串等值
//   - null 与 "" 严格区分（不做相等放宽）
//   - 图片路径：原始源站路径 1:1 等值（两侧都不做 asset() 映射 —— 映射是消费侧职责）
//   - 排序：逐序列比对；标签页网格序为已知限制（P2 单 sort_order 列无法同时编码分类序与标签序）
//     → 集合与字段必须一致，顺序差异如实报告（knownLimitation，不算失败）
// 输出：JSON + Markdown 报告；仅当全部一致（除已知限制）时 exit 0。
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import mysql from "mysql2/promise"
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../../src/lib/db/schema/index.ts"
import { siteLinkDetails } from "../../src/lib/db/schema/index.ts"

import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository.ts"
import { MySqlRepository } from "../../src/lib/facai8/content/mysql-repository.ts"
import type { ContentRepository } from "../../src/lib/facai8/content/repository.ts"

const envSchema = z.object({
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default("facai8_admin"),
  DB_USER: z.string().min(1).default("facai8_app"),
  DB_PASSWORD: z.string().default(""),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
})

type AnyRecord = Record<string, unknown>

interface FieldDiff {
  id: string
  field: string
  static: unknown
  mysql: unknown
}

interface TypeCompare {
  type: string
  staticCount: number
  mysqlCount: number
  countDiff: number
  idMissing: string[] // 静态有、DB 无
  idExtra: string[] // DB 有、静态无
  fieldDiffs: FieldDiff[]
  orderSame: boolean
  orderDiffCount: number
  relations: string[] // 关联校验结论（空 = 无异常）
  knownLimitation: string | null
  ok: boolean
}

interface VerifyReport {
  generatedAt: string
  database: string
  snapshot: "src/lib/facai8/data (2026-11-08 存档)"
  normalizationRules: string[]
  types: TypeCompare[]
  tagOrdering: { tagId: string; tagStatic: number; mysql: number; sequenceSame: boolean; diffPositions: number }[]
  derived: { name: string; staticCount: number; mysqlCount: number; sequenceSame: boolean; fieldDiffs: FieldDiff[]; ok: boolean }[]
  totalRecords: { static: number; mysql: number }
  allOk: boolean
}

function idOf(r: AnyRecord, key: string): string {
  return String(r[key] ?? "")
}

/** 序列比对（ID 序列）；返回差异位置数 */
function diffPositions(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) if ((a[i] ?? "∅") !== (b[i] ?? "∅")) d++
  return d
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || Array.isArray(b)) return false
    const ka = Object.keys(a as AnyRecord)
    const kb = Object.keys(b as AnyRecord)
    if (ka.length !== kb.length) return false
    return ka.every((k) => (a as AnyRecord)[k] === (b as AnyRecord)[k] || deepEqual((a as AnyRecord)[k], (b as AnyRecord)[k]))
  }
  return false
}

function compareList(
  type: string,
  staticRows: AnyRecord[],
  mysqlRows: AnyRecord[],
  fields: string[],
  opts: { knownLimitation?: string } = {},
): TypeCompare {
  const sById = new Map(staticRows.map((r) => [idOf(r, "id"), r]))
  const mById = new Map(mysqlRows.map((r) => [idOf(r, "id"), r]))
  const idMissing = staticRows.map((r) => idOf(r, "id")).filter((id) => !mById.has(id))
  const idExtra = mysqlRows.map((r) => idOf(r, "id")).filter((id) => !sById.has(id))
  const fieldDiffs: FieldDiff[] = []
  for (const [id, sr] of sById) {
    const mr = mById.get(id)
    if (!mr) continue
    for (const f of fields) {
      if (!deepEqual(sr[f], mr[f])) fieldDiffs.push({ id, field: f, static: sr[f], mysql: mr[f] })
    }
  }
  const a = staticRows.map((r) => idOf(r, "id"))
  const b = mysqlRows.map((r) => idOf(r, "id"))
  const orderDiffCount = diffPositions(a, b)
  const knownLimitation = opts.knownLimitation ?? null
  // 排序一致性要求；已知限制类型：顺序差异如实报告但不判失败（集合+字段必须零差异）
  const orderOk = orderDiffCount === 0 || (knownLimitation !== null && a.length === b.length && idMissing.length === 0 && idExtra.length === 0)
  const ok = idMissing.length === 0 && idExtra.length === 0 && fieldDiffs.length === 0 && orderOk
  return {
    type,
    staticCount: staticRows.length,
    mysqlCount: mysqlRows.length,
    countDiff: mysqlRows.length - staticRows.length,
    idMissing,
    idExtra,
    fieldDiffs,
    orderSame: orderDiffCount === 0,
    orderDiffCount,
    relations: [],
    knownLimitation,
    ok,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const jsonPath = args.find((a) => a.startsWith("--json="))?.slice("--json=".length)
  const env = envSchema.parse(process.env)

  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_POOL_SIZE,
    bigNumberStrings: true,
    supportBigNumbers: true,
    timezone: "Z",
    connectTimeout: 10_000,
    charset: "UTF8MB4_UNICODE_CI",
  })
  const db = drizzle(pool, { schema, mode: "default" })
  const dnRes = (await pool.query(`SELECT DATABASE() d`)) as unknown as [unknown]
  const actualDb = String((dnRes[0] as Array<{ d: string }>)[0]?.d ?? "")

  const staticRepo = new StaticSnapshotRepository()
  const mysqlRepo = new MySqlRepository(db as unknown as MySql2Database<typeof schema>)

  const report: VerifyReport = {
    generatedAt: new Date().toISOString(),
    database: actualDb,
    snapshot: "src/lib/facai8/data (2026-11-08 存档)",
    normalizationRules: [
      "ID：两侧一律十进制字符串（BIGINT 精度保护）",
      "日期：两侧 DTO 均为规范形 YYYY-MM-DDTHH:MM:SS（仓库层规范化）→ 直接字符串等值",
      "计数：字符串等值",
      "null 与空字符串严格区分（不做放宽）",
      "图片路径：原始源站路径 1:1 等值（asset() 映射是消费侧职责，两侧 DTO 均不含映射）",
      "标签页网格序：P2 单 sort_order 列无法同时编码分类序与标签序 → 顺序差异为已知限制（集合+字段必须零差异）",
    ],
    types: [],
    tagOrdering: [],
    derived: [],
    totalRecords: { static: 0, mysql: 0 },
    allOk: false,
  }

  // ── 1. 首页分类树（含层级 + 两级顺序） ──
  {
    const s = await staticRepo.getHomeCategories()
    const m = await mysqlRepo.getHomeCategories()
    const flatten = (rows: (typeof s)[number][]): AnyRecord[] =>
      rows.flatMap((c) => [
        { id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder, parentId: null },
        ...c.children.map((x) => ({ id: x.id, name: x.name, icon: x.icon, sortOrder: x.sortOrder, parentId: c.id })),
      ])
    const c = compareList("link_categories", flatten(s), flatten(m), ["name", "icon", "sortOrder"])
    // 层级关系：逐顶层子集比对（children 序列 + 父归属）
    const sTops = new Map(s.map((x) => [x.id, x]))
    const mTops = new Map(m.map((x) => [x.id, x]))
    for (const st of s) {
      const mt = mTops.get(st.id)
      if (!mt) continue
      const sc = st.children.map((x) => x.id)
      const mc = mt.children.map((x) => x.id)
      if (diffPositions(sc, mc) > 0 || st.children.length !== mt.children.length) {
        c.relations.push(`children 序列差异: ${st.id} static=${st.children.length} mysql=${mt.children.length}`)
      }
    }
    for (const mt of m) if (!sTops.has(mt.id)) c.relations.push(`顶层多余: ${mt.id}`)
    if (c.relations.length > 0) c.ok = false
    report.types.push(c)
  }

  // ── 2. 文章分类 ──
  {
    const c = compareList("article_categories", await staticRepo.getArticleCategories() as never, await mysqlRepo.getArticleCategories() as never, ["name", "icon", "sortOrder"])
    report.types.push(c)
  }

  // ── 3. 标签 ──
  {
    const c = compareList("site_tags", await staticRepo.getTags() as never, await mysqlRepo.getTags() as never, ["name", "icon", "color", "bgColor"])
    report.types.push(c)
  }

  // ── 4. 链接（主记录 + 按分类顺序 + 关联） ──
  {
    // 静态侧：逐分类取序列（canonical 顺序 = 源档案序分组）
    const sCats = await staticRepo.getHomeCategories()
    const catIds = sCats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)])
    const sByCat = new Map<string, string[]>()
    for (const cid of catIds) {
      const rows = await staticRepo.getLinksByCategory(cid)
      sByCat.set(cid, rows.map((r) => r.id))
    }
    const mCats = await mysqlRepo.getHomeCategories()
    const mCatIds = mCats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)])
    const mByCat = new Map<string, string[]>()
    for (const cid of mCatIds) {
      const rows = await mysqlRepo.getLinksByCategory(cid)
      mByCat.set(cid, rows.map((r) => r.id))
    }
    const sAllIds = [...sByCat.values()].flat()
    const mAllIds = [...mByCat.values()].flat()
    const base = compareList("site_links", sAllIds.map((id) => ({ id })), mAllIds.map((id) => ({ id })), [])
    // 字段级：逐分类取 DTO 对比
    const fieldDiffs: FieldDiff[] = []
    for (const cid of catIds) {
      const sRows = (await staticRepo.getLinksByCategory(cid)) as unknown as AnyRecord[]
      const mRows = (await mysqlRepo.getLinksByCategory(cid)) as unknown as AnyRecord[]
      const sMap = new Map(sRows.map((r) => [idOf(r, "id"), r]))
      const mMap = new Map(mRows.map((r) => [idOf(r, "id"), r]))
      for (const [id, sr] of sMap) {
        const mr = mMap.get(id)
        if (!mr) continue
        for (const f of ["categoryId", "tagId", "title", "url", "description", "logoUrl", "isGone"]) {
          if (!deepEqual(sr[f], mr[f])) fieldDiffs.push({ id, field: f, static: sr[f], mysql: mr[f] })
        }
      }
      if (diffPositions(sRows.map((r) => idOf(r, "id")), mRows.map((r) => idOf(r, "id"))) > 0) {
        base.orderDiffCount += 1
        base.orderSame = false
      }
    }
    base.fieldDiffs = fieldDiffs
    // 关联校验
    const catIdSet = new Set(mCatIds)
    const tagIds = (await mysqlRepo.getTags()).map((t) => t.id)
    const tagSet = new Set(tagIds)
    const orphanCat: string[] = []
    const orphanTag: string[] = []
    for (const cid of mCatIds) {
      for (const r of (await mysqlRepo.getLinksByCategory(cid)) as unknown as AnyRecord[]) {
        if (!catIdSet.has(String(r.categoryId))) orphanCat.push(`${r.id}->${String(r.categoryId)}`)
        if (r.tagId !== null && !tagSet.has(String(r.tagId))) orphanTag.push(`${r.id}->${String(r.tagId)}`)
      }
    }
    if (orphanCat.length) base.relations.push(`孤儿分类: ${orphanCat.slice(0, 5).join(", ")}`)
    if (orphanTag.length) base.relations.push(`孤儿标签: ${orphanTag.slice(0, 5).join(", ")}`)
    if (base.relations.length > 0) base.ok = false
    if (fieldDiffs.length > 0) base.ok = false
    report.types.push(base)
  }

  // ── 5. 链接详情（122 条；仅源站有档） ──
  {
    // 全量详情 ID 集合：静态仓库无 list 方法 → 直接读冻结源（与静态仓库同一数据，取键集）
    const { LINK_DETAILS } = await import("../../src/lib/facai8/data/link-details.ts")
    const sIds = Object.keys(LINK_DETAILS)
    const sRows = (await Promise.all(sIds.map(async (id) => (await staticRepo.getLinkDetail(id)) as unknown as AnyRecord | null)))
      .filter((x): x is AnyRecord => x !== null)
    const mRowsAll = (await db.select().from(siteLinkDetails)) as unknown as AnyRecord[]
    const mRows = (
      await Promise.all(
        mRowsAll.map(async (r) => {
          const id = idOf(r, "linkId")
          return (await mysqlRepo.getLinkDetail(id)) as unknown as AnyRecord | null
        }),
      )
    ).filter((x): x is AnyRecord => x !== null)
    const c = compareList(
      "site_link_details",
      sRows.map((r) => ({ ...r, id: r.id })),
      mRows.map((r) => ({ ...r, id: r.id })),
      ["clickCount", "likeCount", "createdAt", "updatedAt", "annotation", "previewImage", "logoUrl", "categoryName", "detail"],
      // 详情是逐链接 1:1 查询（前台恒以 getLinkDetail(linkId) 请求）→ 无全局顺序语义；
      // 两侧全集遍历序（档案序 vs 库序）差异为已知限制（集合+字段必须零差异）
      {
        knownLimitation: "详情为逐链接 1:1 查询，无全局顺序 → 顺序差异为已知限制（集合+字段零差异）",
      },
    )
    // 关联：detail 的链接必须存在（DTO 主键 = id）
    const mLinkIds = new Set((await (async () => { const mCats = await mysqlRepo.getHomeCategories(); const ids = mCats.flatMap((c2) => [c2.id, ...c2.children.map((x) => x.id)]); const set = new Set<string>(); for (const cid of ids) for (const r of await mysqlRepo.getLinksByCategory(cid)) set.add(r.id); return set })()))
    const orphanDet = mRows.filter((r) => !mLinkIds.has(idOf(r, "id")))
    if (orphanDet.length) c.relations.push(`孤儿详情: ${orphanDet.slice(0, 5).map((r) => idOf(r, "id")).join(", ")}`)
    if (c.relations.length > 0) c.ok = false
    report.types.push(c)
  }

  // ── 6. 备用链接 ──
  {
    const { LINK_MIRRORS } = await import("../../src/lib/facai8/data/link-mirrors.ts")
    const sRows: AnyRecord[] = []
    for (const [linkId, arr] of Object.entries(LINK_MIRRORS)) {
      const rows = await staticRepo.getLinkMirrors(linkId)
      for (const r of rows) sRows.push({ ...r, linkId })
    }
    // DB 侧：逐有镜像的链接（集合 = 镜像 linkId 全集，经主表）
    const mRows: AnyRecord[] = []
    const mCats = await mysqlRepo.getHomeCategories()
    const catIds = mCats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)])
    const linkIds = new Set<string>()
    for (const cid of catIds) for (const r of await mysqlRepo.getLinksByCategory(cid)) linkIds.add(r.id)
    for (const linkId of linkIds) {
      const rows = await mysqlRepo.getLinkMirrors(linkId)
      for (const r of rows) mRows.push({ ...r, linkId })
    }
    const c = compareList(
      "site_link_mirrors",
      sRows,
      mRows,
      ["linkId", "name", "url"],
      // 备用链接是逐链接查询（前台恒以 getLinkMirrors(linkId) 请求）→ 无全局顺序语义；
      // 两侧全集遍历序（档案序 vs 分类树序）差异为已知限制（集合+字段必须零差异）
      {
        knownLimitation: "备用链接为逐链接查询，无全局顺序 → 顺序差异为已知限制（集合+字段零差异）",
      },
    )
    // 严格校验：每条有镜像链接的「链内顺序」（sort_order = 档案序）两侧必须一致
    const perLinkOrderDiffs: string[] = []
    for (const [linkId] of Object.entries(LINK_MIRRORS)) {
      const sSeq = (await staticRepo.getLinkMirrors(linkId)).map((r) => r.id)
      const mSeq = (await mysqlRepo.getLinkMirrors(linkId)).map((r) => r.id)
      if (sSeq.length !== mSeq.length || sSeq.some((v, i) => v !== mSeq[i])) perLinkOrderDiffs.push(linkId)
    }
    if (perLinkOrderDiffs.length > 0) {
      c.relations.push(`链内顺序不一致: ${perLinkOrderDiffs.slice(0, 5).join(", ")}`)
      c.ok = false
    }
    report.types.push(c)
  }

  // ── 7. 文章（列表 + 顺序 + 关联 + 字段） ──
  {
    const sRows = (await staticRepo.getArticles()) as unknown as AnyRecord[]
    const mRows = (await mysqlRepo.getArticles()) as unknown as AnyRecord[]
    const c = compareList("articles", sRows, mRows, [
      "title",
      "content",
      "coverImage",
      "categoryId",
      "categoryName",
      "seoTitle",
      "seoKeywords",
      "seoDescription",
      "viewCount",
      "createdAt",
      "updatedAt",
      "authorName",
      "authorAvatar",
    ])
    const catSet = new Set((await mysqlRepo.getArticleCategories()).map((x) => x.id))
    const orphan = mRows.filter((r) => !catSet.has(String(r.categoryId)))
    if (orphan.length) c.relations.push(`孤儿文章分类: ${orphan.slice(0, 5).map((r) => idOf(r, "id")).join(", ")}`)
    if (c.relations.length > 0) c.ok = false
    report.types.push(c)
  }

  // ── 8. 公告 ──
  {
    const c = compareList("bulletins", (await staticRepo.getBulletins()) as never, (await mysqlRepo.getBulletins()) as never, ["title", "createdAt", "content"])
    report.types.push(c)
  }

  // ── 9. 广告 ──
  {
    const c = compareList("ads", (await staticRepo.getAds()) as never, (await mysqlRepo.getAds()) as never, ["linkUrl", "imageUrl", "title"])
    report.types.push(c)
  }

  // ── 10. 线路 ──
  {
    const c = compareList("site_lines", (await staticRepo.getLines()) as never, (await mysqlRepo.getLines()) as never, ["name", "url"])
    report.types.push(c)
  }

  // ── 11. 图标库（id 升序规范序） ──
  {
    const c = compareList("icon_libraries", (await staticRepo.getIconLibraries()) as never, (await mysqlRepo.getIconLibraries()) as never, ["prefix", "hash", "cssPath"])
    report.types.push(c)
  }

  // ── 12. 站点页面（4 页） ──
  {
    const keys = ["aboutUs", "disclaimer", "agreement", "privacy"] as const
    const sRows: AnyRecord[] = []
    const mRows: AnyRecord[] = []
    for (const k of keys) {
      const s = await staticRepo.getSitePage(k)
      const m = await mysqlRepo.getSitePage(k)
      sRows.push({ id: k, title: s?.title ?? null, subtitle: s?.subtitle ?? null, html: s?.html ?? null })
      mRows.push({ id: k, title: m?.title ?? null, subtitle: m?.subtitle ?? null, html: m?.html ?? null })
    }
    const c = compareList("site_pages", sRows, mRows, ["title", "subtitle", "html"])
    report.types.push(c)
  }

  // ── 13. 站点设置（10 键 JSON 深度对比） ──
  {
    const s = await staticRepo.getSiteSettings()
    const m = await mysqlRepo.getSiteSettings()
    const sObj = { ...s, id: "settings" } as AnyRecord
    const mObj = { ...m, id: "settings" } as AnyRecord
    const fieldDiffs: FieldDiff[] = []
    for (const f of Object.keys(sObj)) {
      if (f === "id") continue
      if (!deepEqual((sObj as AnyRecord)[f], (mObj as AnyRecord)[f])) fieldDiffs.push({ id: "settings", field: f, static: (sObj as AnyRecord)[f], mysql: (mObj as AnyRecord)[f] })
    }
    const c: TypeCompare = {
      type: "site_settings",
      staticCount: 1,
      mysqlCount: 1,
      countDiff: 0,
      idMissing: [],
      idExtra: [],
      fieldDiffs,
      orderSame: true,
      orderDiffCount: 0,
      relations: [],
      knownLimitation: null,
      ok: fieldDiffs.length === 0,
    }
    report.types.push(c)
  }

  // ── 标签页网格序（已知限制：集合+字段零差异要求，顺序差异如实报告） ──
  {
    const sTags = await staticRepo.getTags()
    for (const t of sTags) {
      const sRows = await staticRepo.getLinksByTag(t.id)
      const mRows = await mysqlRepo.getLinksByTag(t.id)
      const sIds = sRows.map((r) => r.id)
      const mIds = mRows.map((r) => r.id)
      const setSame = sIds.length === mIds.length && sIds.every((id) => mIds.includes(id))
      const pos = diffPositions(sIds, mIds)
      report.tagOrdering.push({
        tagId: t.id,
        tagStatic: sIds.length,
        mysql: mIds.length,
        sequenceSame: pos === 0,
        diffPositions: pos,
      })
      if (!setSame) {
        // 集合不一致 = 真失败（记入 site_links 关联）
        const linksType = report.types.find((x) => x.type === "site_links")
        linksType?.relations.push(`标签 ${t.id} 链接集合不一致 static=${sIds.length} mysql=${mIds.length}`)
        if (linksType) linksType.ok = false
      }
    }
  }

  // ── 派生数据（new links / new articles / recent links） ──
  {
    const check = async (name: string, s: unknown[], m: unknown[]) => {
      const sR = s as AnyRecord[]
      const mR = m as AnyRecord[]
      const fieldDiffs: FieldDiff[] = []
      const sMap = new Map(sR.map((r) => [idOf(r, "id"), r]))
      const mMap = new Map(mR.map((r) => [idOf(r, "id"), r]))
      for (const [id, sr] of sMap) {
        const mr = mMap.get(id)
        if (!mr) continue
        for (const f of Object.keys(sr)) if (!deepEqual(sr[f], mr[f])) fieldDiffs.push({ id, field: f, static: sr[f], mysql: mr[f] })
      }
      const pos = diffPositions(sR.map((r) => idOf(r, "id")), mR.map((r) => idOf(r, "id")))
      const setMissing = sR.filter((r) => !mMap.has(idOf(r, "id"))).length
      const setExtra = mR.filter((r) => !sMap.has(idOf(r, "id"))).length
      return {
        name,
        staticCount: sR.length,
        mysqlCount: mR.length,
        sequenceSame: pos === 0 && setMissing === 0 && setExtra === 0,
        fieldDiffs,
        ok: pos === 0 && setMissing === 0 && setExtra === 0 && fieldDiffs.length === 0,
      }
    }
    report.derived.push(await check("new_links (top10 by detail createdAt)", await staticRepo.getNewLinks(), await mysqlRepo.getNewLinks()))
    report.derived.push(await check("recent_links (site_settings JSON)", await staticRepo.getRecentLinks(), await mysqlRepo.getRecentLinks()))
    report.derived.push(await check("new_articles (top8 by createdAt)", await staticRepo.getNewArticles(), await mysqlRepo.getNewArticles()))
  }

  report.totalRecords = {
    static: report.types.reduce((a, t) => a + t.staticCount, 0),
    mysql: report.types.reduce((a, t) => a + t.mysqlCount, 0),
  }
  report.allOk = report.types.every((t) => t.ok) && report.derived.every((d) => d.ok)

  // ── 输出 ──
  console.log(`\n== P4 数据一致性验证（${actualDb}）==`)
  console.log(`\n类型对比（static vs mysql）:`)
  for (const t of report.types) {
    const flag = t.ok ? "OK " : "FAIL"
    console.log(`  [${flag}] ${t.type.padEnd(20)} static=${t.staticCount} mysql=${t.mysqlCount} 字段差异=${t.fieldDiffs.length} ID缺失=${t.idMissing.length} ID多余=${t.idExtra.length} 顺序差异=${t.orderDiffCount}${t.knownLimitation ? "（已知限制）" : ""}`)
    if (t.relations.length) for (const r of t.relations) console.log(`         关联: ${r}`)
    if (t.fieldDiffs.length > 0 && t.fieldDiffs.length <= 8)
      for (const f of t.fieldDiffs) console.log(`         字段: ${f.id}.${f.field} static=${JSON.stringify(f.static)} mysql=${JSON.stringify(f.mysql)}`)
  }
  console.log(`\n标签页网格序（已知限制：P2 单 sort_order 列）:`)
  for (const t of report.tagOrdering) console.log(`  ${t.tagId} static=${t.tagStatic} mysql=${t.mysql} 顺序一致=${t.sequenceSame ? "是" : `否（差异位置 ${t.diffPositions}，集合一致）`}`)
  console.log(`\n派生数据:`)
  for (const d of report.derived) console.log(`  [${d.ok ? "OK" : "FAIL"}] ${d.name} static=${d.staticCount} mysql=${d.mysqlCount} 字段差异=${d.fieldDiffs.length}`)
  console.log(`\n结论: ${report.allOk ? "全部一致 ✓（含已知标签序限制，集合+字段零差异）" : "存在差异 ✗（详见报告）"}`)

  if (jsonPath) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    console.log(`JSON 报告: ${jsonPath}`)
  }
  await pool.end()
  process.exit(report.allOk ? 0 : 1)
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isDirectRun) {
  main().catch((err: Error) => {
    console.error(`[verify] FAIL: ${err.message}`)
    process.exit(1)
  })
}
