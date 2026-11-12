// P4/P7：静态快照导入核心（scripts/admin/import-static-snapshot.ts 抽取；CLI 与后台导入管理共用）
// ─────────────────────────────────────────────────────────────────
// 用法入口：
//   - CLI：scripts/admin/import-static-snapshot.ts（本文件薄封装，行为与 P4 完全一致）
//   - 后台：src/lib/admin/services/import-service.ts（P7：注入管理员上下文 + 差异预览）
// 安全语义（P4 §8/§13，P7 沿用）：
//   - dry-run 不产生任何 INSERT/UPDATE/DELETE（连 admin_import_runs 也不写）
//   - 正式导入必须 execute 且 confirmDatabase 与实际连接库名完全一致
//   - NODE_ENV=production 默认拒绝；需「调用方确认」与 ADMIN_IMPORT_ALLOW_PRODUCTION=1 双因子
//   - 内容导入 = 单事务（FK 顺序、500 条/批）；任何一步失败整体回滚，导入记录标记 failed
//   - 重复导入保护：同版本同 checksum 已成功 → no-op；同版本不同 checksum → 拒绝；
//     内容表非空且无匹配成功记录 → 拒绝冲突
//   - 不使用 ON DUPLICATE KEY UPDATE / INSERT IGNORE；不清空表
//   - started_by：CLI 恒 NULL（无管理员上下文，不伪造身份）；后台注入真实管理员 ID（P7 §7）
// 注意：本模块被 tsx/node 直接执行的 CLI 复用，禁止 import "server-only"；
//       也禁止引入 next/* —— 只用相对路径导入（node 原生类型剥离不解析 "@/" 别名）。
import { createHash } from "node:crypto"
import mysql from "mysql2/promise"
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2"
import { eq } from "drizzle-orm"

import { LINK_CATEGORIES } from "../../facai8/data/categories.ts"
import { ALL_LINKS } from "../../facai8/data/links.ts"
import { CAT_ORDER, applyLinkOrder } from "../../facai8/data/link-order.ts"
import { LINK_DETAILS } from "../../facai8/data/link-details.ts"
import { LINK_MIRRORS } from "../../facai8/data/link-mirrors.ts"
import { TAGS } from "../../facai8/data/tags.ts"
import { ALL_ARTICLES } from "../../facai8/data/articles.ts"
import { ARTICLE_CATEGORIES } from "../../facai8/data/article-categories.ts"
import { BULLETINS } from "../../facai8/data/bulletins.ts"
import { HOME_ADS } from "../../facai8/data/ads.ts"
import { ALL_LINES } from "../../facai8/data/lines.ts"
import { SITE_INFO } from "../../facai8/data/site-info.ts"
import { ICON_LIBRARIES } from "../../facai8/data/icon-libraries.ts"
import { SITE_STATIC } from "../../facai8/data/site-static.ts"
import { HOME_POPUP } from "../../facai8/data/popup.ts"
import { STATS } from "../../facai8/data/stats.ts"
import { RECENT_LINKS } from "../../facai8/data/recent-links.ts"
import { SEARCH_DESCRIPTIONS } from "../../facai8/data/searchDescriptions.ts"

import { canonFromSource, dbFromCanon, utcNowCanon } from "../../facai8/content/dates.ts"
import * as schema from "../../db/schema/index.ts"
import {
  ads,
  adminImportRuns,
  articleCategories,
  articles,
  bulletins,
  iconLibraries,
  linkCategories,
  siteLines,
  siteLinkDetails,
  siteLinkMirrors,
  siteLinks,
  sitePages,
  siteSettings,
  siteTags,
} from "../../db/schema/index.ts"

export interface ImportCreds {
  host: string
  port: number
  database: string
  user: string
  password: string
  poolSize: number
}

export interface ImportOptions {
  snapshotVersion: string
  /** false = dry-run（零写入）；true = 正式导入 */
  execute: boolean
  /** 必须与实际连接库名完全一致（execute 时强制校验） */
  confirmDatabase?: string
  /** NODE_ENV=production 时需要（与 ADMIN_IMPORT_ALLOW_PRODUCTION 环境变量共同生效） */
  allowProduction?: boolean
  productionEnvAuthorized?: boolean
  /** 可注入节点环境（测试用） */
  nodeEnv?: string
  /** 可注入快照（测试用；缺省 = buildStaticSnapshot()） */
  snapshot?: StaticSnapshot
  /**
   * P7：run 行的 started_by（真实管理员 BIGINT 十进制字符串）。
   * 缺省 = null（CLI 语义：无管理员上下文，不伪造身份）。
   */
  startedBy?: string | null
  /**
   * P7：内容事务提交前的钩子（与内容插入同一 tx；典型用途 = 成功审计写入，
   * 审计失败 → 内容事务整体回滚）。CLI 不传 → 行为与 P4 完全一致。
   */
  onContentInserted?: (ctx: {
    tx: ImportContentTx
    runId: string
    snapshot: StaticSnapshot
    counts: Record<string, number>
    importTs: string
  }) => Promise<void>
}

export interface ImportResult {
  ok: boolean
  mode: "dry_run" | "import"
  outcome: "planned" | "imported" | "no_op" | "refused" | "rolled_back" | "error"
  checksum: string
  targetDb: string | null
  /** 快照侧计划行数（13 表） */
  counts: Record<string, number>
  /** 数据库实际行数（dry-run = 现状回查；imported = 导入后回查） */
  dbCounts?: Record<string, number>
  runId?: string
  /** P7：no-op 时命中的历史成功记录 ID（供后台返回「历史记录 ID」，不假装没发生） */
  noOpRunId?: string
  error?: string
  report: string[]
}

export const CONTENT_TABLES = [
  "link_categories",
  "article_categories",
  "site_tags",
  "site_links",
  "site_link_details",
  "site_link_mirrors",
  "articles",
  "bulletins",
  "ads",
  "site_lines",
  "site_pages",
  "icon_libraries",
  "site_settings",
] as const

const ID_RE = /^\d{1,20}$/

// ── 快照构建（源数据 → 规范快照对象；canonical 序 + 规范日期） ─────────────

export interface StaticSnapshot {
  archiveDate: string
  linkCategories: { id: string; parentId: string | null; name: string; iconClass: string; sortOrder: number }[]
  articleCategories: { id: string; name: string; iconClass: string; sortOrder: number }[]
  siteTags: { id: string; name: string; iconClass: string; color: string; bgColor: string; sortOrder: number }[]
  siteLinks: {
    id: string
    categoryId: string
    tagId: string | null
    title: string
    url: string
    description: string
    logoPath: string
    isGone: boolean
    sortOrder: number
  }[]
  siteLinkDetails: {
    linkId: string
    clickCount: string
    likeCount: string
    annotation: string
    previewImage: string
    detailHtml: string
    sourceCreatedAt: string
    sourceUpdatedAt: string
  }[]
  siteLinkMirrors: { id: string; linkId: string; name: string; url: string; sortOrder: number }[]
  articles: {
    id: string
    categoryId: string
    title: string
    contentHtml: string
    coverImage: string
    categoryNameSnapshot: string
    seoTitle: string
    seoKeywords: string
    seoDescription: string
    viewCount: string
    authorName: string
    authorAvatar: string
    publishedAt: string
    sourceUpdatedAt: string
  }[]
  bulletins: { id: string; title: string; contentHtml: string; publishedAt: string; sortOrder: number }[]
  ads: { id: string; position: string; title: string; targetUrl: string; imagePath: string; sortOrder: number }[]
  siteLines: { id: string; name: string; url: string; sortOrder: number }[]
  iconLibraries: { id: string; prefix: string; hash: string; cssPath: string }[]
  sitePages: { pageKey: string; title: string; subtitle: string; contentHtml: string }[]
  siteSettings: { key: string; value: unknown }[]
}

/** 源数据文件 → 规范快照（确定性：canonical 序、规范日期；非法输入直接抛错，绝不静默修正） */
export function buildStaticSnapshot(): StaticSnapshot {
  const errors: string[] = []
  const fail = (msg: string) => errors.push(msg)

  const catName = new Map<string, string>()
  for (const c of LINK_CATEGORIES) {
    catName.set(c.id, c.name)
    for (const s of c.children) catName.set(s.id, s.name)
  }
  const tagIds = new Set(TAGS.map((t) => t.id))

  // 分类：两级展平（canonical 序 = 源数组序；sortOrder 取源值 —— 已验证各层无并列 → (sort_order, id) 复现数组序）
  const linkCategoriesSnap: StaticSnapshot["linkCategories"] = []
  {
    const seen = new Set<string>()
    const push = (id: string, parentId: string | null, name: string, icon: string, sortOrder: string) => {
      if (!ID_RE.test(id)) return fail(`category bad id: ${id}`)
      if (seen.has(id)) return fail(`category dup id: ${id}`)
      seen.add(id)
      linkCategoriesSnap.push({ id, parentId, name, iconClass: icon, sortOrder: Number(sortOrder) })
    }
    for (const c of LINK_CATEGORIES) {
      push(c.id, null, c.name, c.icon, c.sortOrder)
      for (const s of c.children) push(s.id, c.id, s.name, s.icon, s.sortOrder)
    }
  }

  // 链接：sort_order = 每分类 applyLinkOrder(CAT_ORDER 序列, 档案序追加) 的稠密排名（§6 规范序，与前台分类页渲染序一致）
  const siteLinksSnap: StaticSnapshot["siteLinks"] = []
  {
    const seen = new Set<string>()
    const byCat = new Map<string, (typeof ALL_LINKS)[number][]>()
    for (const l of ALL_LINKS) {
      if (!ID_RE.test(l.id)) fail(`link bad id: ${l.id}`)
      if (seen.has(l.id)) fail(`link dup id: ${l.id}`)
      seen.add(l.id)
      const arr = byCat.get(l.categoryId) ?? []
      arr.push(l)
      byCat.set(l.categoryId, arr)
    }
    for (const [catId, links] of byCat) {
      if (!catName.has(catId)) fail(`link orphan category: ${catId} (${links.length} links)`)
      const ordered = applyLinkOrder(links, CAT_ORDER[catId])
      for (let i = 0; i < ordered.length; i++) {
        const l = ordered[i]
        if (l.tagId && !tagIds.has(l.tagId)) fail(`link orphan tag: ${l.id} -> ${l.tagId}`)
        if (!/^https?:\/\//.test(l.url)) fail(`link bad url: ${l.id} ${l.url}`)
        siteLinksSnap.push({
          id: l.id,
          categoryId: l.categoryId,
          tagId: l.tagId,
          title: l.title,
          url: l.url,
          description: l.description,
          logoPath: l.logoUrl,
          isGone: l.isGone === 1,
          sortOrder: i,
        })
      }
    }
    // 入库序 = 源档案序（便于审计比对；查询序由 sort_order 决定，与入库序无关）
    const order = new Map(ALL_LINKS.map((l, i) => [l.id, i]))
    siteLinksSnap.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  }

  // 详情：只入源站有档的 122 条（缺失不伪造）；logo/categoryName 不入库（已验证与链接/分类恒等 → mapper 派生，无损）
  const siteLinkDetailsSnap: StaticSnapshot["siteLinkDetails"] = []
  {
    const linkById = new Map(ALL_LINKS.map((l) => [l.id, l]))
    for (const d of Object.values(LINK_DETAILS)) {
      if (!ID_RE.test(d.id)) fail(`detail bad id: ${d.id}`)
      const l = linkById.get(d.id)
      if (!l) {
        fail(`detail orphan link: ${d.id}`)
        continue
      }
      if (!/^\d+$/.test(d.clickCount)) fail(`detail non-numeric clickCount: ${d.id}`)
      if (!/^\d+$/.test(d.likeCount)) fail(`detail non-numeric likeCount: ${d.id}`)
      // 派生恒等性守卫：源快照值与当前链接/分类不一致时拒绝导入（无损映射前提不成立 → 需 schema 决策）
      if (d.logoUrl !== "" && d.logoUrl !== l.logoUrl) fail(`detail logoUrl 不可派生（与链接 logo 不一致）: ${d.id}`)
      if (d.categoryName !== (catName.get(l.categoryId) ?? "")) fail(`detail categoryName 不可派生（与分类名不一致）: ${d.id}`)
      siteLinkDetailsSnap.push({
        linkId: d.id,
        clickCount: d.clickCount,
        likeCount: d.likeCount,
        annotation: d.annotation,
        previewImage: d.previewImage,
        detailHtml: d.detail,
        sourceCreatedAt: canonFromSource(d.createdAt),
        sourceUpdatedAt: canonFromSource(d.updatedAt),
      })
    }
    siteLinkDetailsSnap.sort((a, b) => (a.linkId < b.linkId ? -1 : a.linkId > b.linkId ? 1 : 0))
  }

  // 备用链接：98 条（源 mirror.id 显式写入自增 PK 列，保留 17 位源 ID；sort_order = 数组下标）
  const siteLinkMirrorsSnap: StaticSnapshot["siteLinkMirrors"] = []
  {
    const linkIds = new Set(ALL_LINKS.map((l) => l.id))
    const seen = new Set<string>()
    for (const [linkId, arr] of Object.entries(LINK_MIRRORS)) {
      if (!linkIds.has(linkId)) fail(`mirror orphan link: ${linkId}`)
      arr.forEach((m, i) => {
        if (!ID_RE.test(m.id)) fail(`mirror bad id: ${m.id}`)
        if (seen.has(m.id)) fail(`mirror dup id: ${m.id}`)
        seen.add(m.id)
        siteLinkMirrorsSnap.push({ id: m.id, linkId, name: m.name, url: m.url, sortOrder: i })
      })
    }
    siteLinkMirrorsSnap.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  // 文章：published_at = 源 createdAt；审计 updated_at = 源 updatedAt（schema 无 source_updated_at 列，无损承载源快照时间）
  const articlesSnap: StaticSnapshot["articles"] = []
  {
    const artCats = new Set(ARTICLE_CATEGORIES.map((c) => c.id))
    for (const a of ALL_ARTICLES) {
      if (!ID_RE.test(a.id)) fail(`article bad id: ${a.id}`)
      if (!artCats.has(a.categoryId)) fail(`article orphan category: ${a.id} -> ${a.categoryId}`)
      if (!/^\d+$/.test(a.viewCount)) fail(`article non-numeric viewCount: ${a.id}`)
      articlesSnap.push({
        id: a.id,
        categoryId: a.categoryId,
        title: a.title,
        contentHtml: a.content,
        coverImage: a.coverImage,
        categoryNameSnapshot: a.categoryName,
        seoTitle: a.seoTitle,
        seoKeywords: a.seoKeywords,
        seoDescription: a.seoDescription,
        viewCount: a.viewCount,
        authorName: a.authorName,
        authorAvatar: a.authorAvatar,
        publishedAt: canonFromSource(a.createdAt),
        sourceUpdatedAt: canonFromSource(a.updatedAt),
      })
    }
    articlesSnap.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  const siteTagsSnap: StaticSnapshot["siteTags"] = []
  {
    const seen = new Set<string>()
    TAGS.forEach((t, i) => {
      if (!ID_RE.test(t.id)) fail(`tag bad id: ${t.id}`)
      if (seen.has(t.id)) fail(`tag dup id: ${t.id}`)
      seen.add(t.id)
      siteTagsSnap.push({ id: t.id, name: t.name, iconClass: t.icon, color: t.color, bgColor: t.bgColor, sortOrder: i })
    })
  }

  const iconLibrariesSnap: StaticSnapshot["iconLibraries"] = ICON_LIBRARIES.slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((i) => ({ id: i.id, prefix: i.prefix, hash: i.hash, cssPath: i.cssPath }))

  const pageKeys = Object.keys(SITE_STATIC) as (keyof typeof SITE_STATIC)[]

  const snapshot: StaticSnapshot = {
    archiveDate: "2026-11-08",
    linkCategories: linkCategoriesSnap,
    articleCategories: ARTICLE_CATEGORIES.map((c) => ({ id: c.id, name: c.name, iconClass: c.icon, sortOrder: 0 })),
    siteTags: siteTagsSnap,
    siteLinks: siteLinksSnap,
    siteLinkDetails: siteLinkDetailsSnap,
    siteLinkMirrors: siteLinkMirrorsSnap,
    articles: articlesSnap,
    bulletins: BULLETINS.map((b, i) => ({
      id: b.id,
      title: b.title,
      contentHtml: b.content,
      publishedAt: canonFromSource(b.createdAt),
      sortOrder: i,
    })),
    ads: HOME_ADS.map((a, i) => ({
      id: a.id,
      position: "home",
      title: a.title,
      targetUrl: a.linkUrl,
      imagePath: a.imageUrl,
      sortOrder: i,
    })),
    siteLines: ALL_LINES.map((l, i) => ({ id: l.id, name: l.name, url: l.url, sortOrder: i })),
    iconLibraries: iconLibrariesSnap,
    sitePages: pageKeys.map((k) => ({
      pageKey: k,
      title: SITE_STATIC[k].title,
      subtitle: SITE_STATIC[k].subtitle,
      contentHtml: SITE_STATIC[k].html,
    })),
    siteSettings: [
      { key: "site_name", value: SITE_INFO.siteName },
      { key: "site_description", value: SITE_INFO.siteDescription },
      { key: "site_logo", value: SITE_INFO.siteLogo },
      { key: "site_favicon", value: SITE_INFO.siteFavicon },
      { key: "footer_text", value: SITE_INFO.footerText },
      { key: "ads_random", value: SITE_INFO.adsRandom },
      { key: "home_popup", value: { enabled: HOME_POPUP.enabled, title: HOME_POPUP.title, content: HOME_POPUP.content } },
      { key: "stats", value: { ...STATS } },
      { key: "search_descriptions", value: { ...SEARCH_DESCRIPTIONS } },
      // 源站 /api/public/recent-links 快照（不可复算 → 1:1 存档，数组序即展示序）
      { key: "recent_links", value: RECENT_LINKS.map((m) => ({ ...m })) },
    ],
  }

  if (errors.length > 0) throw new Error(`snapshot pre-check failed:\n  - ${errors.join("\n  - ")}`)
  return snapshot
}

/** 规范快照 → SHA-256 checksum（固定键序 JSON 序列化 → 确定性，跨进程/跨平台一致） */
export function computeChecksum(s: StaticSnapshot): string {
  const canonical = {
    archiveDate: s.archiveDate,
    linkCategories: s.linkCategories,
    articleCategories: s.articleCategories,
    siteTags: s.siteTags,
    siteLinks: s.siteLinks,
    siteLinkDetails: s.siteLinkDetails,
    siteLinkMirrors: s.siteLinkMirrors,
    articles: s.articles,
    bulletins: s.bulletins,
    ads: s.ads,
    siteLines: s.siteLines,
    iconLibraries: s.iconLibraries,
    sitePages: s.sitePages,
    siteSettings: s.siteSettings,
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

// ── 行构建（规范快照 → drizzle insert values；$inferInsert 全类型） ───────

export type AppDb = MySql2Database<typeof schema>

/** 内容事务类型（P7 后台审计钩子与 writeAudit/AdminTx 结构一致） */
export type ImportContentTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0]

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const BATCH = 500

type CatInsert = typeof linkCategories.$inferInsert
type ArtCatInsert = typeof articleCategories.$inferInsert
type TagInsert = typeof siteTags.$inferInsert
type LinkInsert = typeof siteLinks.$inferInsert
type DetInsert = typeof siteLinkDetails.$inferInsert
type MirInsert = typeof siteLinkMirrors.$inferInsert
type ArticleInsert = typeof articles.$inferInsert
type BulInsert = typeof bulletins.$inferInsert
type AdInsert = typeof ads.$inferInsert
type LineInsert = typeof siteLines.$inferInsert
type PageInsert = typeof sitePages.$inferInsert
type IconInsert = typeof iconLibraries.$inferInsert
type SettingInsert = typeof siteSettings.$inferInsert

/** FK 依赖顺序的表插入（§8.4：分类→标签→链接→详情→镜像→文章→公告→广告→线路→页面→图标库→设置） */
export async function insertAllContent(db: AppDb, s: StaticSnapshot, ts: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  const catRows: CatInsert[] = s.linkCategories.map((c) => ({
    id: BigInt(c.id),
    parentId: c.parentId ? BigInt(c.parentId) : null,
    name: c.name,
    iconClass: c.iconClass,
    sortOrder: c.sortOrder,
    status: "active",
    sourceSnapshot: true,
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(catRows, BATCH)) await db.insert(linkCategories).values(c)
  counts.link_categories = catRows.length

  const artCatRows: ArtCatInsert[] = s.articleCategories.map((c) => ({
    id: BigInt(c.id),
    name: c.name,
    iconClass: c.iconClass,
    sortOrder: c.sortOrder,
    status: "active",
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(artCatRows, BATCH)) await db.insert(articleCategories).values(c)
  counts.article_categories = artCatRows.length

  const tagRows: TagInsert[] = s.siteTags.map((t) => ({
    id: BigInt(t.id),
    name: t.name,
    iconClass: t.iconClass,
    color: t.color,
    bgColor: t.bgColor,
    status: "active",
    sortOrder: t.sortOrder,
    version: 1,
    createdAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(tagRows, BATCH)) await db.insert(siteTags).values(c)
  counts.site_tags = tagRows.length

  const linkRows: LinkInsert[] = s.siteLinks.map((l) => ({
    id: BigInt(l.id),
    categoryId: BigInt(l.categoryId),
    tagId: l.tagId ? BigInt(l.tagId) : null,
    title: l.title,
    url: l.url,
    description: l.description,
    logoPath: l.logoPath,
    isGone: l.isGone,
    status: "published",
    sortOrder: l.sortOrder,
    sourceSnapshot: true,
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(linkRows, BATCH)) await db.insert(siteLinks).values(c)
  counts.site_links = linkRows.length

  const detRows: DetInsert[] = s.siteLinkDetails.map((d) => ({
    linkId: BigInt(d.linkId),
    clickCount: BigInt(d.clickCount),
    likeCount: BigInt(d.likeCount),
    annotation: d.annotation,
    previewImage: d.previewImage,
    detailHtml: d.detailHtml,
    sourceCreatedAt: dbFromCanon(d.sourceCreatedAt),
    sourceUpdatedAt: dbFromCanon(d.sourceUpdatedAt),
    updatedAt: dbFromCanon(ts),
  }))
  for (const c of chunk(detRows, BATCH)) await db.insert(siteLinkDetails).values(c)
  counts.site_link_details = detRows.length

  const mirRows: MirInsert[] = s.siteLinkMirrors.map((m) => ({
    id: BigInt(m.id),
    linkId: BigInt(m.linkId),
    name: m.name,
    url: m.url,
    sortOrder: m.sortOrder,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
  }))
  for (const c of chunk(mirRows, BATCH)) await db.insert(siteLinkMirrors).values(c)
  counts.site_link_mirrors = mirRows.length

  const artRows: ArticleInsert[] = s.articles.map((a) => ({
    id: BigInt(a.id),
    categoryId: BigInt(a.categoryId),
    title: a.title,
    contentHtml: a.contentHtml,
    coverImage: a.coverImage,
    categoryNameSnapshot: a.categoryNameSnapshot,
    seoTitle: a.seoTitle,
    seoKeywords: a.seoKeywords,
    seoDescription: a.seoDescription,
    viewCount: BigInt(a.viewCount),
    authorName: a.authorName,
    authorAvatar: a.authorAvatar,
    status: "published",
    publishedAt: dbFromCanon(a.publishedAt),
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(a.sourceUpdatedAt),
    deletedAt: null,
  }))
  for (const c of chunk(artRows, BATCH)) await db.insert(articles).values(c)
  counts.articles = artRows.length

  const bulRows: BulInsert[] = s.bulletins.map((b) => ({
    id: BigInt(b.id),
    title: b.title,
    contentHtml: b.contentHtml,
    status: "published",
    sortOrder: b.sortOrder,
    publishedAt: dbFromCanon(b.publishedAt),
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(bulRows, BATCH)) await db.insert(bulletins).values(c)
  counts.bulletins = bulRows.length

  const adRows: AdInsert[] = s.ads.map((a) => ({
    id: BigInt(a.id),
    position: a.position,
    title: a.title,
    targetUrl: a.targetUrl,
    imagePath: a.imagePath,
    status: "active",
    sortOrder: a.sortOrder,
    startsAt: null,
    endsAt: null,
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(adRows, BATCH)) await db.insert(ads).values(c)
  counts.ads = adRows.length

  const lineRows: LineInsert[] = s.siteLines.map((l) => ({
    id: BigInt(l.id),
    name: l.name,
    url: l.url,
    status: "active",
    sortOrder: l.sortOrder,
    version: 1,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
    deletedAt: null,
  }))
  for (const c of chunk(lineRows, BATCH)) await db.insert(siteLines).values(c)
  counts.site_lines = lineRows.length

  const pageRows: PageInsert[] = s.sitePages.map((p) => ({
    pageKey: p.pageKey,
    title: p.title,
    subtitle: p.subtitle,
    contentHtml: p.contentHtml,
    version: 1,
    updatedBy: null,
    createdAt: dbFromCanon(ts),
    updatedAt: dbFromCanon(ts),
  }))
  for (const c of chunk(pageRows, BATCH)) await db.insert(sitePages).values(c)
  counts.site_pages = pageRows.length

  const iconRows: IconInsert[] = s.iconLibraries.map((i) => ({
    id: BigInt(i.id),
    prefix: i.prefix,
    hash: i.hash,
    cssPath: i.cssPath,
    status: "active",
    createdAt: dbFromCanon(ts),
  }))
  for (const c of chunk(iconRows, BATCH)) await db.insert(iconLibraries).values(c)
  counts.icon_libraries = iconRows.length

  const settingRows: SettingInsert[] = s.siteSettings.map((x) => ({
    settingKey: x.key,
    settingValue: JSON.stringify(x.value),
    updatedBy: null,
    updatedAt: dbFromCanon(ts),
  }))
  for (const c of chunk(settingRows, BATCH)) await db.insert(siteSettings).values(c)
  counts.site_settings = settingRows.length

  return counts
}

// ── 导入执行 ───────────────────────────────────────────────────────────────

export function makeImportPool(creds: ImportCreds) {
  return mysql.createPool({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: creds.database,
    connectionLimit: creds.poolSize,
    bigNumberStrings: true,
    supportBigNumbers: true,
    timezone: "Z",
    connectTimeout: 10_000,
    charset: "UTF8MB4_UNICODE_CI",
  })
}

export function drizzleOfImportPool(pool: mysql.Pool): AppDb {
  return drizzle(pool, { schema, mode: "default" })
}

export async function readTableCounts(pool: mysql.Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of CONTENT_TABLES) {
    const res = (await pool.query(`SELECT COUNT(*) c FROM \`${t}\``)) as unknown as [unknown]
    const rows = res[0] as Array<{ c: number | string | bigint }>
    out[t] = Number(rows[0]?.c ?? 0)
  }
  return out
}

/**
 * 导入核心（可注入凭据/快照/环境，供单元测试与 P7 后台导入管理复用）：
 * dry-run → 预检 + 计划（零写入）；execute → 安全检查 + 导入记录行 + 内容事务 + 终态更新。
 */
export async function runStaticImport(creds: ImportCreds, opts: ImportOptions): Promise<ImportResult> {
  const report: string[] = []
  const say = (line: string) => report.push(line)
  const result: ImportResult = {
    ok: false,
    mode: opts.execute ? "import" : "dry_run",
    outcome: "error",
    checksum: "",
    targetDb: null,
    counts: {},
    report,
  }

  const pool = makeImportPool(creds)
  try {
    // 1) 连接 + 实际库名
    const dnRes = (await pool.query(`SELECT DATABASE() d`)) as unknown as [unknown]
    const actualDb = String((dnRes[0] as Array<{ d: string }>)[0]?.d ?? "")
    result.targetDb = actualDb
    say(`连接: ${creds.user}@${creds.host}:${creds.port}/${actualDb}`)

    // 2) 生产环境保护（NODE_ENV=production 默认拒绝；调用方确认 + 环境变量双因子）
    const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? ""
    if (nodeEnv === "production") {
      if (!opts.allowProduction || !opts.productionEnvAuthorized) {
        result.outcome = "refused"
        result.error = "NODE_ENV=production 默认拒绝导入；需同时提供 --allow-production 参数与 ADMIN_IMPORT_ALLOW_PRODUCTION=1 环境变量"
        say(`拒绝: ${result.error}`)
        return result
      }
      say("生产环境导入授权: 确认参数 + 环境变量 双因子已确认")
    }

    // 3) 快照构建 + 预检 + checksum
    const snapshot = opts.snapshot ?? buildStaticSnapshot()
    result.checksum = computeChecksum(snapshot)
    result.counts = {
      link_categories: snapshot.linkCategories.length,
      article_categories: snapshot.articleCategories.length,
      site_tags: snapshot.siteTags.length,
      site_links: snapshot.siteLinks.length,
      site_link_details: snapshot.siteLinkDetails.length,
      site_link_mirrors: snapshot.siteLinkMirrors.length,
      articles: snapshot.articles.length,
      bulletins: snapshot.bulletins.length,
      ads: snapshot.ads.length,
      site_lines: snapshot.siteLines.length,
      icon_libraries: snapshot.iconLibraries.length,
      site_pages: snapshot.sitePages.length,
      site_settings: snapshot.siteSettings.length,
    }
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0)
    say(`快照: version=${opts.snapshotVersion} checksum=${result.checksum}`)
    say(
      `计划导入 ${total} 行 / 13 表（NEW_LINKS/NEW_ARTICLES 为可复算派生数据不入库；recent_links 等 10 键设置以 JSON 存档）`,
    )

    // 4) execute 门禁：库名确认（必须与实际连接库名完全一致）
    if (opts.execute) {
      if (!opts.confirmDatabase || opts.confirmDatabase !== actualDb) {
        result.outcome = "refused"
        result.error = `--confirm-database 与实际库名不一致（实际 "${actualDb}"，传入 "${opts.confirmDatabase ?? ""}"）`
        say(`拒绝: ${result.error}`)
        return result
      }
      say(`库名确认: ${actualDb} ✓`)
    }

    // 5) 表存在性（必须先执行过 db:migrate）
    const tblRes = (await pool.query(`SHOW TABLES`)) as unknown as [unknown]
    // mysql2 非 prepared 的 SHOW TABLES 行形态为对象 { Tables_in_<库名>: 表名 }（不是数组）
    const tables = new Set(
      (tblRes[0] as Array<Record<string, unknown>>).map((r) => String(Object.values(r)[0] ?? "")),
    )
    const missing = [...CONTENT_TABLES, "admin_import_runs"].filter((t) => !tables.has(t))
    if (missing.length > 0) {
      result.outcome = "refused"
      result.error = `目标库缺少表: ${missing.join(", ")}（请先执行 npm run db:migrate）`
      say(`拒绝: ${result.error}`)
      return result
    }

    // 6) 重复导入保护
    const dbCounts = await readTableCounts(pool)
    const allEmpty = Object.values(dbCounts).every((n) => n === 0)
    const runRes = (await pool.query(
      `SELECT id, checksum, status FROM admin_import_runs WHERE snapshot_version = ? AND mode = 'import' ORDER BY id`,
      [opts.snapshotVersion],
    )) as unknown as [unknown]
    const prior = (runRes[0] as Array<{ id: number | string | bigint; checksum: string | null; status: string }>).map(
      (r) => ({ id: String(r.id), checksum: r.checksum ?? "", status: r.status }),
    )
    const succeeded = prior.filter((r) => r.status === "succeeded")
    say(
      `内容表现状: ${allEmpty ? "13 表全空" : "非空 -> " + Object.entries(dbCounts).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(", ")}`,
    )
    say(`同版本历史导入: ${prior.length} 次（成功 ${succeeded.length}）`)

    if (!allEmpty) {
      if (succeeded.some((r) => r.checksum === result.checksum)) {
        result.outcome = "no_op"
        result.ok = true
        result.noOpRunId = succeeded.find((r) => r.checksum === result.checksum)?.id
        result.dbCounts = dbCounts
        say("安全 no-op: 相同快照版本+checksum 已成功导入过，不重复写入")
        return result
      }
      result.outcome = "refused"
      result.error = "内容表非空且无匹配成功记录（同版本不同快照，或未知来源数据）→ 拒绝导入；需差异报告 + 另行授权的增量同步方案"
      say(`拒绝: ${result.error}`)
      return result
    }
    if (succeeded.some((r) => r.checksum !== result.checksum)) {
      result.outcome = "refused"
      result.error = "相同快照版本的历史成功记录 checksum 不同（快照内容已变化）→ 拒绝"
      say(`拒绝: ${result.error}`)
      return result
    }
    if (succeeded.length > 0) {
      result.outcome = "no_op"
      result.ok = true
      result.noOpRunId = succeeded[succeeded.length - 1]?.id
      result.dbCounts = dbCounts
      say("安全 no-op: 相同快照版本+checksum 已成功导入过（内容表现为空，不重复写入/重建）")
      return result
    }

    // 7) dry-run → 输出计划（零写入）
    if (!opts.execute) {
      result.outcome = "planned"
      result.ok = true
      result.dbCounts = dbCounts
      say("dry-run 完成：未执行任何 INSERT/UPDATE/DELETE（含 admin_import_runs）")
      say(`确认无误后执行: npm run admin:import -- --execute --snapshot-version=${opts.snapshotVersion} --confirm-database=${actualDb}`)
      return result
    }

    // 8) 正式导入：导入记录行（内容事务之外；失败也留痕；started_by：CLI=null，后台=真实管理员）
    const db = drizzleOfImportPool(pool)
    const importTs = utcNowCanon()
    const insRes = await db.insert(adminImportRuns).values({
      snapshotVersion: opts.snapshotVersion,
      mode: "import",
      status: "running",
      checksum: result.checksum,
      summaryJson: null,
      startedBy: opts.startedBy ? BigInt(opts.startedBy) : null,
      startedAt: dbFromCanon(importTs),
      finishedAt: null,
      errorSummary: null,
    })
    const runId = String((insRes[0] as { insertId: number | bigint } | null)?.insertId ?? "")
    result.runId = runId
    say(`导入记录: admin_import_runs#${runId} (running)` + (opts.startedBy ? ` started_by=${opts.startedBy}` : " (CLI)"))

    // 9) 内容事务（FK 顺序 + 500/批；任何一步失败 → 整体回滚；P7：成功审计在同一事务内）
    try {
      await db.transaction(async (tx) => {
        // tx 与 db 同构（MySql2Database 形状）；类型收敛到 AppDb，形状由 schema 保证
        const counts = await insertAllContent(tx as unknown as AppDb, snapshot, importTs)
        result.counts = counts
        say(`事务内插入: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(" ")}`)
        if (opts.onContentInserted) {
          await opts.onContentInserted({ tx, runId, snapshot, counts, importTs })
          say("事务内审计: 成功审计已随内容写入（审计失败将回滚整个内容事务）")
        }
      })
      // 10) 终态：成功
      await db
        .update(adminImportRuns)
        .set({
          status: "succeeded",
          finishedAt: dbFromCanon(utcNowCanon()),
          summaryJson: JSON.stringify({ counts: result.counts, total: Object.values(result.counts).reduce((a, b) => a + b, 0) }),
          errorSummary: null,
        })
        .where(eq(adminImportRuns.id, BigInt(runId)))
      result.outcome = "imported"
      result.ok = true
      result.dbCounts = await readTableCounts(pool)
      say(`导入完成: 内容事务已提交；admin_import_runs#${runId} = succeeded`)
      return result
    } catch (e) {
      // 11) 失败：drizzle 已回滚内容事务；导入记录标记 failed（诚实留痕）
      // drizzle DrizzleQueryError 顶层 message 仅 "Failed query: <SQL>"，真实 MySQL 错误在 cause —— 底层错误前置，避免被超长 SQL 截断
      const causeMsg = e instanceof Error && e.cause instanceof Error ? e.cause.message : ""
      const outerMsg = e instanceof Error ? e.message : String(e)
      const msg = causeMsg ? `${causeMsg} | ${outerMsg}` : outerMsg
      try {
        await db
          .update(adminImportRuns)
          .set({ status: "failed", finishedAt: dbFromCanon(utcNowCanon()), errorSummary: msg.slice(0, 2000) })
          .where(eq(adminImportRuns.id, BigInt(runId)))
      } catch {
        /* 留痕更新失败不掩盖主错误 */
      }
      result.outcome = "rolled_back"
      result.error = msg
      say(`失败: 内容事务整体回滚（${msg.slice(0, 200)}）；admin_import_runs#${runId} = failed`)
      return result
    }
  } catch (e) {
    result.outcome = "error"
    result.error = e instanceof Error ? e.message : String(e)
    say(`异常: ${result.error}`)
    return result
  } finally {
    await pool.end()
  }
}
