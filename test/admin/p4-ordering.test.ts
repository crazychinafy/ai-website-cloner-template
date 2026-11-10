// P4 测试 5：排序（§12.5）—— CAT_ORDER 与 MySQL sort_order 逐分类比对，全部一致
// 覆盖 P4 §6 要求：每个分类的链接总数 / ID 集合 / ID 顺序 完全一致；外加文章/广告/标签/线路/派生序
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import * as schema from "../../src/lib/db/schema/index.ts"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { siteLinks } from "../../src/lib/db/schema/index.ts"
import { asc } from "drizzle-orm"
import { setupP4Scratch, teardownP4Scratch, importP4Snapshot } from "./p4-harness"
import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository"
import { MySqlRepository } from "../../src/lib/facai8/content/mysql-repository"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { CAT_ORDER, applyLinkOrder } from "../../src/lib/facai8/data/link-order"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import { HOME_ADS } from "../../src/lib/facai8/data/ads"
import { TAGS } from "../../src/lib/facai8/data/tags"
import { ALL_LINES } from "../../src/lib/facai8/data/lines"

let pool: Pool
let staticRepo: StaticSnapshotRepository
let mysqlRepo: MySqlRepository
let db: MySql2Database<typeof schema>

beforeAll(async () => {
  pool = await setupP4Scratch()
  const res = await importP4Snapshot("p4-test")
  if (res.outcome !== "imported" && res.outcome !== "no_op") throw new Error(`setup import failed: ${res.outcome} ${res.error}`)
  db = drizzle(pool, { schema, mode: "default" }) as unknown as MySql2Database<typeof schema>
  staticRepo = new StaticSnapshotRepository()
  mysqlRepo = new MySqlRepository(db)
}, 180_000)

afterAll(async () => {
  await teardownP4Scratch(pool)
}, 120_000)

describe("P4 排序（CAT_ORDER ↔ MySQL sort_order）", () => {
  it("全部有链接的分类：静态序 == MySQL 序（总数 / 集合 / 顺序 三维一致）", async () => {
    const byCat = new Map<string, (typeof ALL_LINKS)[number][]>()
    for (const l of ALL_LINKS) {
      const arr = byCat.get(l.categoryId) ?? []
      arr.push(l)
      byCat.set(l.categoryId, arr)
    }
    const catIds = [...byCat.keys()]
    expect(catIds.length).toBe(90)
    let largest = 0
    for (const cid of catIds) {
      const staticIds = (await staticRepo.getLinksByCategory(cid)).map((l) => l.id)
      const mysqlIds = (await mysqlRepo.getLinksByCategory(cid)).map((l) => l.id)
      // 总数
      expect(mysqlIds.length, `count ${cid}`).toBe(staticIds.length)
      largest = Math.max(largest, staticIds.length)
      // 集合
      expect([...mysqlIds].sort(), `set ${cid}`).toEqual([...staticIds].sort())
      // 顺序（逐位）
      expect(mysqlIds, `order ${cid}`).toEqual(staticIds)
    }
    expect(largest).toBe(638) // WG 为最大分类（审计值）
  })

  it("顺序规则 = CAT_ORDER 序列优先 + 档案序追加（与 applyLinkOrder 一致）", async () => {
    const byCat = new Map<string, (typeof ALL_LINKS)[number][]>()
    for (const l of ALL_LINKS) {
      const arr = byCat.get(l.categoryId) ?? []
      arr.push(l)
      byCat.set(l.categoryId, arr)
    }
    let checked = 0
    for (const [cid, links] of byCat) {
      const expected = applyLinkOrder(links, CAT_ORDER[cid]).map((l) => l.id)
      const mysqlIds = (await mysqlRepo.getLinksByCategory(cid)).map((l) => l.id)
      expect(mysqlIds, cid).toEqual(expected)
      checked++
    }
    expect(checked).toBe(90)
  })

  it("site_links.sort_order 为每分类 0..n-1 稠密排名（直查 DB 验证）", async () => {
    // 取三个规模不同的分类：最大（WG 638）/ 中等 / 最小（1 条）
    const catIds = [...new Set(ALL_LINKS.map((l) => l.categoryId))]
    const counts = catIds.map((cid) => ({ cid, n: ALL_LINKS.filter((l) => l.categoryId === cid).length }))
    counts.sort((a, b) => b.n - a.n)
    const picks = [counts[0], counts[Math.floor(counts.length / 2)], counts[counts.length - 1]]
    for (const { cid, n } of picks) {
      // 直接全量取后过滤（3791 行，测试可接受）
      const all = (await db
        .select({ categoryId: siteLinks.categoryId, sortOrder: siteLinks.sortOrder })
        .from(siteLinks)
        .orderBy(asc(siteLinks.sortOrder), asc(siteLinks.id))) as Array<{ categoryId: bigint; sortOrder: number }>
      const ofCat = all.filter((r) => String(r.categoryId) === cid).sort((a, b) => a.sortOrder - b.sortOrder)
      expect(ofCat.length).toBe(n)
      expect(ofCat.map((r) => r.sortOrder)).toEqual(Array.from({ length: n }, (_, i) => i)) // 稠密 0..n-1
    }
  })

  it("文章列表顺序一致（createdAt 降序、id 降序）", async () => {
    const s = (await staticRepo.getArticles()).map((a) => a.id)
    const m = (await mysqlRepo.getArticles()).map((a) => a.id)
    expect(m).toEqual(s)
    // 与源规则一致
    const cmpId = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0)
    const expected = ALL_ARTICLES.slice()
      .sort((a, b) => (a.createdAt === b.createdAt ? cmpId(b.id, a.id) : a.createdAt < b.createdAt ? 1 : -1))
      .map((a) => a.id)
    expect(s).toEqual(expected)
  })

  it("公告 / 广告 / 标签 / 线路 / 文章分类 / 图标库 顺序一致", async () => {
    expect((await mysqlRepo.getBulletins()).map((b) => b.id)).toEqual((await staticRepo.getBulletins()).map((b) => b.id))
    expect((await mysqlRepo.getAds()).map((a) => a.id)).toEqual((await staticRepo.getAds()).map((a) => a.id))
    expect((await mysqlRepo.getAds()).map((a) => a.id)).toEqual(HOME_ADS.map((a) => a.id)) // = 源数组序
    expect((await mysqlRepo.getTags()).map((t) => t.id)).toEqual(TAGS.map((t) => t.id)) // = 源数组序
    expect((await mysqlRepo.getLines()).map((l) => l.id)).toEqual(ALL_LINES.map((l) => l.id)) // = 源数组序
    const mIcons = (await mysqlRepo.getIconLibraries()).map((i) => i.id)
    const sIcons = (await staticRepo.getIconLibraries()).map((i) => i.id)
    expect(mIcons).toEqual(sIcons)
    const mCats = (await mysqlRepo.getArticleCategories()).map((c) => c.id)
    const sCats = (await staticRepo.getArticleCategories()).map((c) => c.id)
    expect(mCats).toEqual(sCats)
  })

  it("派生数据顺序一致（newLinks / newArticles）；recentLinks 两侧同序", async () => {
    expect((await mysqlRepo.getNewLinks()).map((l) => l.id)).toEqual((await staticRepo.getNewLinks()).map((l) => l.id))
    expect((await mysqlRepo.getNewArticles()).map((a) => a.id)).toEqual((await staticRepo.getNewArticles()).map((a) => a.id))
    expect((await mysqlRepo.getRecentLinks()).map((l) => l.id)).toEqual((await staticRepo.getRecentLinks()).map((l) => l.id))
  })

  it("标签页网格序：集合一致（顺序差异为 P2 单 sort_order 列的已知限制，如实断言集合）", async () => {
    for (const t of TAGS) {
      const s = (await staticRepo.getLinksByTag(t.id)).map((l) => l.id).sort()
      const m = (await mysqlRepo.getLinksByTag(t.id)).map((l) => l.id).sort()
      expect(m, `tag ${t.name}`).toEqual(s)
    }
  })
})
