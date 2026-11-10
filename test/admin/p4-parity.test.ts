// P4 测试 3：Repository 双实现一致性（§12.3）—— 相同输入下 StaticSnapshot 与 MySql 返回相同 DTO
// scratch 导入后对全部 13 类数据 + 派生数据做深度对比（toEqual 递归等值，含顺序/空值语义）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import * as schema from "../../src/lib/db/schema/index.ts"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { setupP4Scratch, teardownP4Scratch, importP4Snapshot } from "./p4-harness"
import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository"
import { MySqlRepository } from "../../src/lib/facai8/content/mysql-repository"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { LINK_DETAILS } from "../../src/lib/facai8/data/link-details"
import { LINK_MIRRORS } from "../../src/lib/facai8/data/link-mirrors"
import { ARTICLE_CATEGORIES } from "../../src/lib/facai8/data/article-categories"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"

let pool: Pool
let staticRepo: StaticSnapshotRepository
let mysqlRepo: MySqlRepository

beforeAll(async () => {
  pool = await setupP4Scratch()
  const res = await importP4Snapshot("p4-test")
  if (res.outcome !== "imported" && res.outcome !== "no_op") throw new Error(`setup import failed: ${res.outcome} ${res.error}`)
  staticRepo = new StaticSnapshotRepository()
  mysqlRepo = new MySqlRepository(drizzle(pool, { schema, mode: "default" }) as unknown as MySql2Database<typeof schema>)
}, 180_000)

afterAll(async () => {
  await teardownP4Scratch(pool)
}, 120_000)

describe("P4 Repository 一致性（static vs mysql）", () => {
  it("首页分类树（层级 + 两级顺序 + 字段）", async () => {
    expect(await mysqlRepo.getHomeCategories()).toEqual(await staticRepo.getHomeCategories())
  })

  it("分类网址列表（全部 94 节点：集合 + 顺序 + 字段逐条一致）", async () => {
    const cats = await staticRepo.getHomeCategories()
    const catIds = cats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)])
    expect(catIds.length).toBe(94)
    for (const cid of catIds) {
      expect(await mysqlRepo.getLinksByCategory(cid), `category ${cid}`).toEqual(await staticRepo.getLinksByCategory(cid))
    }
    // 未知分类 → 两侧均空
    expect(await mysqlRepo.getLinksByCategory("1")).toEqual(await staticRepo.getLinksByCategory("1"))
  })

  it("网址主记录（getLinkById：存在 / 不存在）", async () => {
    for (const l of [ALL_LINKS[0], ALL_LINKS[1000], ALL_LINKS[3000], ALL_LINKS[ALL_LINKS.length - 1]]) {
      expect(await mysqlRepo.getLinkById(l.id), l.id).toEqual(await staticRepo.getLinkById(l.id))
    }
    expect(await mysqlRepo.getLinkById("42")).toEqual(await staticRepo.getLinkById("42"))
    expect(await staticRepo.getLinkById("42")).toBeNull()
  })

  it("网址详情（122 条有档 + 无档 → 两侧一致；字段全等）", async () => {
    const detIds = Object.keys(LINK_DETAILS)
    expect(detIds.length).toBe(122)
    for (const id of detIds) {
      expect(await mysqlRepo.getLinkDetail(id), id).toEqual(await staticRepo.getLinkDetail(id))
    }
    // 无档 → 两侧 null
    const noDet = ALL_LINKS.map((l) => l.id).filter((id) => !LINK_DETAILS[id])
    for (const id of noDet.slice(0, 5)) {
      expect(await mysqlRepo.getLinkDetail(id)).toBeNull()
      expect(await staticRepo.getLinkDetail(id)).toBeNull()
    }
  })

  it("备用链接（66 条有镜像 + 无镜像 → 两侧一致）", async () => {
    const keys = Object.keys(LINK_MIRRORS)
    expect(keys.length).toBe(66)
    for (const k of keys) {
      expect(await mysqlRepo.getLinkMirrors(k), k).toEqual(await staticRepo.getLinkMirrors(k))
    }
    const noMirror = ALL_LINKS.map((l) => l.id).filter((id) => !LINK_MIRRORS[id])
    for (const id of noMirror.slice(0, 5)) {
      expect(await mysqlRepo.getLinkMirrors(id)).toEqual([])
    }
  })

  it("文章分类（字段 + 顺序）", async () => {
    expect(await mysqlRepo.getArticleCategories()).toEqual(await staticRepo.getArticleCategories())
    const src = await staticRepo.getArticleCategories()
    expect(src.map((c) => c.id)).toEqual(ARTICLE_CATEGORIES.map((c) => c.id))
  })

  it("文章列表（28 篇：createdAt 降序 + 字段全等）与按分类过滤", async () => {
    expect(await mysqlRepo.getArticles()).toEqual(await staticRepo.getArticles())
    const cats = ARTICLE_CATEGORIES.map((c) => c.id)
    for (const cid of cats) {
      expect(await mysqlRepo.getArticles({ categoryId: cid }), cid).toEqual(await staticRepo.getArticles({ categoryId: cid }))
    }
    for (const a of [ALL_ARTICLES[0], ALL_ARTICLES[13], ALL_ARTICLES[27]]) {
      expect(await mysqlRepo.getArticleById(a.id)).toEqual(await staticRepo.getArticleById(a.id))
    }
  })

  it("公告 / 广告 / 标签 / 线路（字段 + 顺序）", async () => {
    expect(await mysqlRepo.getBulletins()).toEqual(await staticRepo.getBulletins())
    expect(await mysqlRepo.getAds()).toEqual(await staticRepo.getAds())
    expect(await mysqlRepo.getTags()).toEqual(await staticRepo.getTags())
    expect(await mysqlRepo.getLines()).toEqual(await staticRepo.getLines())
  })

  it("图标库（id 升序规范序 + 字段）", async () => {
    expect(await mysqlRepo.getIconLibraries()).toEqual(await staticRepo.getIconLibraries())
  })

  it("站点设置（10 键 JSON 深度一致：popup/stats/searchDescriptions/recentLinks 等）", async () => {
    expect(await mysqlRepo.getSiteSettings()).toEqual(await staticRepo.getSiteSettings())
  })

  it("站点页面（4 页字段全等）", async () => {
    for (const k of ["aboutUs", "disclaimer", "agreement", "privacy"] as const) {
      expect(await mysqlRepo.getSitePage(k), k).toEqual(await staticRepo.getSitePage(k))
    }
    expect(await mysqlRepo.getSitePage("aboutUs")).not.toBeNull()
  })

  it("派生数据（newLinks / recentLinks / newArticles 两侧一致）", async () => {
    expect(await mysqlRepo.getNewLinks()).toEqual(await staticRepo.getNewLinks())
    expect(await mysqlRepo.getRecentLinks()).toEqual(await staticRepo.getRecentLinks())
    expect(await mysqlRepo.getNewArticles()).toEqual(await staticRepo.getNewArticles())
  })

  it("标签链接（集合一致；顺序差异为已知限制 —— P2 单 sort_order 列）", async () => {
    const tags = await staticRepo.getTags()
    expect(tags.length).toBe(5)
    for (const t of tags) {
      const s = (await staticRepo.getLinksByTag(t.id)).map((l) => l.id).sort()
      const m = (await mysqlRepo.getLinksByTag(t.id)).map((l) => l.id).sort()
      expect(m, `tag ${t.id} 集合`).toEqual(s)
    }
  })

  it("数据源标识（source 字段）", async () => {
    expect(staticRepo.source).toBe("static")
    expect(mysqlRepo.source).toBe("mysql")
  })
})
