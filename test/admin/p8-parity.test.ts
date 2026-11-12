// P8-1/2 测试 2：双数据源逐位一致（真实数据，非 mock）—— scratch 导入后
// StaticSnapshotRepository vs MySqlRepository 对全部页面级读取方法深度对比（toEqual 含顺序/空值语义）。
// 覆盖 P8 新增面：getLinksGroupedForHome / getBulletinById / getTagById /
// getRelatedLinksForArticle / getRelatedArticlesForLink / searchLinks / searchArticles，
// 以及 P8-1 改造过的读取（getNewLinks innerJoin、可见性谓词叠加后的列表方法）。
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { setupP8Scratch, teardownP8Scratch, importP8Snapshot, p8MysqlRepo } from "./p8-harness"
import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository"
import { LINK_CATEGORIES } from "../../src/lib/facai8/data/categories"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { LINK_DETAILS } from "../../src/lib/facai8/data/link-details"
import { LINK_MIRRORS } from "../../src/lib/facai8/data/link-mirrors"
import { TAGS } from "../../src/lib/facai8/data/tags"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import { ARTICLE_CATEGORIES } from "../../src/lib/facai8/data/article-categories"
import { BULLETINS } from "../../src/lib/facai8/data/bulletins"

const FAKE_ID = "999999999999999999"

const QUERIES = ["a", "ai", "网", "导航", "影视", "直播", "彩票", "666", "黑平台", "CMS", "不存在zzz"]

let pool: Pool
let mysqlRepo: ReturnType<typeof p8MysqlRepo>
const staticRepo = new StaticSnapshotRepository()

beforeAll(async () => {
  pool = await setupP8Scratch()
  const res = await importP8Snapshot("p8-test")
  if (res.outcome !== "imported" && res.outcome !== "no_op") throw new Error(`setup import failed: ${res.outcome} ${res.error}`)
  mysqlRepo = p8MysqlRepo(pool)
}, 180_000)

afterAll(async () => {
  await teardownP8Scratch(pool)
})

describe("网址与分类", () => {
  it("getHomeCategories", async () => {
    expect(await mysqlRepo.getHomeCategories()).toEqual(await staticRepo.getHomeCategories())
  })
  it("getLinksGroupedForHome（P8-1：3791 链接全量分组，组内档案序）", async () => {
    const [m, s] = await Promise.all([mysqlRepo.getLinksGroupedForHome(), staticRepo.getLinksGroupedForHome()])
    expect(Object.keys(m).sort()).toEqual(Object.keys(s).sort())
    expect(m).toEqual(s)
  })
  // 样本从真实数据推导（不硬编码下标）：链接最多的 3 个一级 + 2 个二级分类，
  // 保证 parity 落在「有数据」的分组上（空组对比无法暴露排序/字段差异）。
  const linkCount = new Map<string, number>()
  for (const l of ALL_LINKS) linkCount.set(l.categoryId, (linkCount.get(l.categoryId) ?? 0) + 1)
  const rank = (c: { id: string }) => linkCount.get(c.id) ?? 0
  const topWithLinks = LINK_CATEGORIES.filter((c) => rank(c) > 0).sort((a, b) => rank(b) - rank(a))
  const subCats = LINK_CATEGORIES.flatMap((c) => c.children).filter((c) => rank(c) > 0).sort((a, b) => rank(b) - rank(a))
  const catSamples = [...topWithLinks.slice(0, 3), ...subCats.slice(0, 2)].map((c) => c.id)
  if (catSamples.length < 5) throw new Error("分类样本不足，检查档案数据")
  for (const cid of catSamples) {
    it(`getLinksByCategory(${cid})`, async () => {
      expect(await mysqlRepo.getLinksByCategory(cid)).toEqual(await staticRepo.getLinksByCategory(cid))
    })
  }
  it("getLinksByCategory 未知分类 → 双侧同空", async () => {
    expect(await mysqlRepo.getLinksByCategory(FAKE_ID)).toEqual(await staticRepo.getLinksByCategory(FAKE_ID))
  })
  for (const t of TAGS) {
    it(`getLinksByTag(${t.id})（P8-0 tag_sort_order 严格序列）`, async () => {
      expect(await mysqlRepo.getLinksByTag(t.id)).toEqual(await staticRepo.getLinksByTag(t.id))
    })
  }
  it("getLinkById 样本（含 isGone 行）+ 未知 → null", async () => {
    const samples = [...ALL_LINKS.slice(0, 5), ...ALL_LINKS.filter((l) => l.isGone === 1).slice(0, 3)]
    for (const l of samples) {
      expect(await mysqlRepo.getLinkById(l.id)).toEqual(await staticRepo.getLinkById(l.id))
    }
    expect(await mysqlRepo.getLinkById(FAKE_ID)).toEqual(await staticRepo.getLinkById(FAKE_ID))
  })
  it("getLinkDetail 全部 122 条档案逐条一致 + 无档链接 → null（不伪造）", async () => {
    for (const id of Object.keys(LINK_DETAILS)) {
      expect(await mysqlRepo.getLinkDetail(id)).toEqual(await staticRepo.getLinkDetail(id))
    }
    const noDetail = ALL_LINKS.find((l) => !LINK_DETAILS[l.id])!
    expect(await mysqlRepo.getLinkDetail(noDetail.id)).toBeNull()
    expect(await staticRepo.getLinkDetail(noDetail.id)).toBeNull()
  })
  it("getLinkMirrors 全部有备链链接逐条一致 + 无备链 → []", async () => {
    for (const id of Object.keys(LINK_MIRRORS)) {
      expect(await mysqlRepo.getLinkMirrors(id)).toEqual(await staticRepo.getLinkMirrors(id))
    }
    const noMirror = ALL_LINKS.find((l) => !LINK_MIRRORS[l.id])!
    expect(await mysqlRepo.getLinkMirrors(noMirror.id)).toEqual(await staticRepo.getLinkMirrors(noMirror.id))
  })
})

describe("文章与关联推荐", () => {
  it("getArticles 全量（含正文/SEO/作者全字段）", async () => {
    expect(await mysqlRepo.getArticles()).toEqual(await staticRepo.getArticles())
  })
  for (const c of ARTICLE_CATEGORIES.slice(0, 3)) {
    it(`getArticles({categoryId: ${c.id}})`, async () => {
      expect(await mysqlRepo.getArticles({ categoryId: c.id })).toEqual(await staticRepo.getArticles({ categoryId: c.id }))
    })
  }
  it("getArticleById 全部 28 条 + 未知 → null", async () => {
    for (const a of ALL_ARTICLES) {
      expect(await mysqlRepo.getArticleById(a.id)).toEqual(await staticRepo.getArticleById(a.id))
    }
    expect(await mysqlRepo.getArticleById(FAKE_ID)).toEqual(await staticRepo.getArticleById(FAKE_ID))
  })
  it("getRelatedLinksForArticle 全部 28 篇（P8-1 服务端规则）", async () => {
    for (const a of ALL_ARTICLES) {
      expect(await mysqlRepo.getRelatedLinksForArticle(a.id)).toEqual(await staticRepo.getRelatedLinksForArticle(a.id))
    }
  })
  it("getRelatedArticlesForLink 全链接抽样 20 条（含 isGone 行）+ 未知 → []", async () => {
    const samples = [
      ...[0, 1, 2, 3, 4, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3790].map((i) => ALL_LINKS[i]),
      ...ALL_LINKS.filter((l) => l.isGone === 1).slice(0, 4),
      ...ALL_LINKS.filter((l) => l.tagId !== null).slice(0, 3),
    ]
    for (const l of samples) {
      expect(await mysqlRepo.getRelatedArticlesForLink(l.id)).toEqual(await staticRepo.getRelatedArticlesForLink(l.id))
    }
    expect(await mysqlRepo.getRelatedArticlesForLink(FAKE_ID)).toEqual(await staticRepo.getRelatedArticlesForLink(FAKE_ID))
  })
  it("getNewArticles / getRecentLinks", async () => {
    expect(await mysqlRepo.getNewArticles()).toEqual(await staticRepo.getNewArticles())
    expect(await mysqlRepo.getRecentLinks()).toEqual(await staticRepo.getRecentLinks())
  })
})

describe("搜索（服务端执行 + 上限截断语义两侧一致）", () => {
  for (const q of QUERIES) {
    it(`searchLinks(${JSON.stringify(q)})`, async () => {
      expect(await mysqlRepo.searchLinks(q)).toEqual(await staticRepo.searchLinks(q))
    })
  }
  for (const q of QUERIES) {
    it(`searchArticles(${JSON.stringify(q)})`, async () => {
      expect(await mysqlRepo.searchArticles(q)).toEqual(await staticRepo.searchArticles(q))
    })
  }
  it("searchArticles 命中序 = createdAt 降序、id 降序（列表规范序，MySQL (published_at,id) 恒等）", async () => {
    const res = await mysqlRepo.searchArticles("a")
    expect(res.total).toBeGreaterThan(1)
    for (let i = 1; i < res.items.length; i++) {
      const prev = res.items[i - 1]
      const cur = res.items[i]
      expect(prev.createdAt > cur.createdAt || (prev.createdAt === cur.createdAt && prev.id > cur.id)).toBe(true)
    }
  })
})

describe("站点运营数据", () => {
  it("getBulletins / getBulletinById（含未知 → null，前台页内空态语义）", async () => {
    expect(await mysqlRepo.getBulletins()).toEqual(await staticRepo.getBulletins())
    expect(await mysqlRepo.getBulletinById(BULLETINS[0].id)).toEqual(await staticRepo.getBulletinById(BULLETINS[0].id))
    expect(await mysqlRepo.getBulletinById(FAKE_ID)).toEqual(await staticRepo.getBulletinById(FAKE_ID))
  })
  it("getAds(home)", async () => {
    expect(await mysqlRepo.getAds()).toEqual(await staticRepo.getAds())
  })
  it("getLines", async () => {
    expect(await mysqlRepo.getLines()).toEqual(await staticRepo.getLines())
  })
  it("getTags / getTagById（含未知 → null，标签页空态语义）", async () => {
    expect(await mysqlRepo.getTags()).toEqual(await staticRepo.getTags())
    expect(await mysqlRepo.getTagById(TAGS[0].id)).toEqual(await staticRepo.getTagById(TAGS[0].id))
    expect(await mysqlRepo.getTagById(FAKE_ID)).toEqual(await staticRepo.getTagById(FAKE_ID))
  })
  it("getArticleCategories", async () => {
    expect(await mysqlRepo.getArticleCategories()).toEqual(await staticRepo.getArticleCategories())
  })
})

describe("站点设置与静态文案", () => {
  it("getSiteSettings（含 searchDescriptions 快照）", async () => {
    expect(await mysqlRepo.getSiteSettings()).toEqual(await staticRepo.getSiteSettings())
  })
  it("getSitePage 全部 4 个静态页面键", async () => {
    for (const slug of ["aboutUs", "disclaimer", "privacy", "agreement"] as const) {
      expect(await mysqlRepo.getSitePage(slug), slug).toEqual(await staticRepo.getSitePage(slug))
    }
  })
  it("getIconLibraries", async () => {
    expect(await mysqlRepo.getIconLibraries()).toEqual(await staticRepo.getIconLibraries())
  })
})

describe("P8-1 改造回归", () => {
  it("getNewLinks（innerJoin 可见链接重写的序与字段仍与档案恒等）", async () => {
    expect(await mysqlRepo.getNewLinks()).toEqual(await staticRepo.getNewLinks())
  })
})
