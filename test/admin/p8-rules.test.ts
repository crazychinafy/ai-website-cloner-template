// P8-1/2 测试 1：规则恒等（无数据库）—— rules.ts / 静态 Repository 与旧 util.ts 在真实静态档案上逐位一致
// 这是「页面改走 Repository 后行为不变」的纯逻辑面证明：
//   搜索命中集合、摘要回退、相关推荐（去重 / 点击数 / 上限）在任何数据源下都必须是这套语义。
import { describe, expect, it } from "vitest"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { SEARCH_DESCRIPTIONS } from "../../src/lib/facai8/data/searchDescriptions"
import { articleExcerpt as utilArticleExcerpt } from "../../src/lib/facai8/util"
import {
  relatedArticlesForLink,
  relatedLinksForArticle,
  searchArticles as utilSearchArticles,
  searchLinks as utilSearchLinks,
} from "../../src/lib/facai8/util-static-data"
import { SEARCH_ARTICLE_LIMIT, SEARCH_LINK_LIMIT } from "../../src/lib/facai8/content/repository"
import { articleExcerpt, pickRelatedArticles, pickRelatedLinks, searchHit } from "../../src/lib/facai8/content/rules"
import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository"

const repo = new StaticSnapshotRepository()

const QUERIES = ["", "   ", "a", "ai", "网", "导航", "影视", "直播", "彩票", "666", "黑平台", "CMS", "不存在的词zzz"]

describe("rules.articleExcerpt ≡ util.articleExcerpt", () => {
  it("28 篇真实文章正文逐字节一致", () => {
    for (const a of ALL_ARTICLES) {
      expect(articleExcerpt(a.content)).toBe(utilArticleExcerpt(a.content))
    }
  })
  it("边界：空串 / 恰好 100 / 101 字符（去标签后）", () => {
    const t100 = "x".repeat(100)
    const t101 = "y".repeat(101)
    expect(articleExcerpt("")).toBe("")
    expect(articleExcerpt(`<p>${t100}</p>`)).toBe(t100)
    expect(articleExcerpt(`<p>${t101}</p>`)).toBe(t101.slice(0, 100) + "…")
    // 换行原样保留（不压缩空白）
    expect(articleExcerpt("<p>a\n\nb</p>")).toBe("a\n\nb")
  })
})

describe("rules.searchHit 语义（JS toLowerCase 基准，忽略大小写、不折叠口音）", () => {
  it("大小写不敏感 / 口音敏感 / 空 needle 恒真", () => {
    expect(searchHit("CmsBoLi", "cms")).toBe(true)
    expect(searchHit("CMS工具", "cms")).toBe(true)
    expect(searchHit("café", "cafe")).toBe(false)
    expect(searchHit("anything", "")).toBe(true)
  })
})

describe("静态 Repository.searchLinks ≡ util.searchLinks（真实档案 3791 链接）", () => {
  for (const q of QUERIES) {
    it(`query=${JSON.stringify(q)}`, async () => {
      const utilRes = utilSearchLinks(q)
      const repoRes = await repo.searchLinks(q)
      expect(repoRes.total).toBe(utilRes.length)
      expect(repoRes.truncated).toBe(utilRes.length > SEARCH_LINK_LIMIT)
      expect(repoRes.items).toEqual(utilRes.slice(0, SEARCH_LINK_LIMIT))
    })
  }
  it("至少一个查询真实触发截断（防止上限语义从未被执行过）", async () => {
    const res = await repo.searchLinks("a")
    expect(res.total).toBeGreaterThan(SEARCH_LINK_LIMIT)
    expect(res.items.length).toBe(SEARCH_LINK_LIMIT)
    expect(res.truncated).toBe(true)
  })
})

describe("静态 Repository.searchArticles ≡ util.searchArticles（真实档案 28 文章）", () => {
  for (const q of QUERIES) {
    it(`query=${JSON.stringify(q)} 命中集合与摘要一致`, async () => {
      const utilRes = utilSearchArticles(q)
      const repoRes = await repo.searchArticles(q)
      expect(repoRes.total).toBe(utilRes.length)
      expect(repoRes.truncated).toBe(utilRes.length > SEARCH_ARTICLE_LIMIT)
      // 命中集合恒等（两侧同序：createdAt 降序、id 降序 —— util 按档案序喂入，
      // 差异只在档案序 ≠ 规范序时出现；此处按 id 排序后深度对比，序差异单独断言见 p8-parity）
      const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      expect(byId(repoRes.items)).toEqual(byId(utilRes))
    })
  }
  it("description 快照全覆盖（28/28 真实文章均有源站搜索摘要快照，逐条回放原文）", async () => {
    const snapIds = Object.keys(SEARCH_DESCRIPTIONS)
    expect(snapIds.length).toBe(ALL_ARTICLES.length)
    let checked = 0
    for (const id of snapIds) {
      const art = ALL_ARTICLES.find((a) => a.id === id)
      if (!art) continue
      const res = await repo.searchArticles(art.title)
      const hit = res.items.find((i) => i.id === id)
      if (hit) {
        expect(hit.description).toBe(SEARCH_DESCRIPTIONS[id])
        // 快照 11 条为旧截断逻辑（含以「…」开头等形态），与统一规则产物不同 → 必须原样回放而非重算
        checked++
      }
    }
    expect(checked).toBe(snapIds.length)
    // 快照中存在与「统一规则重算」不同的条目（历史新旧逻辑混存）→ 证明「快照优先」不是空契约
    let differs = 0
    for (const a of ALL_ARTICLES) {
      if (SEARCH_DESCRIPTIONS[a.id] !== undefined && SEARCH_DESCRIPTIONS[a.id] !== articleExcerpt(a.content)) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })
})

describe("静态 Repository.getRelatedLinksForArticle ≡ util.relatedLinksForArticle（全部 28 篇）", () => {
  it("逐篇深度一致（同名去重取点击最大 → 点击降序 → 上限 1）", async () => {
    for (const a of ALL_ARTICLES) {
      expect(await repo.getRelatedLinksForArticle(a.id)).toEqual(relatedLinksForArticle(a))
    }
  })
  it("不存在的文章 → []", async () => {
    expect(await repo.getRelatedLinksForArticle("999999999999999999")).toEqual([])
  })
})

describe("静态 Repository.getRelatedArticlesForLink ≡ util.relatedArticlesForLink（全部 3791 链接）", () => {
  it("逐条深度一致（标题去重首现 → createdAt 降序 → 上限 10）", async () => {
    for (const l of ALL_LINKS) {
      expect(await repo.getRelatedArticlesForLink(l.id)).toEqual(relatedArticlesForLink(l))
    }
  })
  it("不存在的链接 → []", async () => {
    expect(await repo.getRelatedArticlesForLink("999999999999999999")).toEqual([])
  })
})

describe("rules 纯函数单元语义（合成数据，锁定去重/排序/上限规则）", () => {
  it("pickRelatedLinks：同名去重保留点击数最大者；点击并列保留候选首现（= 列表规范序）", () => {
    const mk = (title: string) => ({ id: title, title })
    const c = (title: string, clicks: number) => ({ item: mk(title), clicks })
    // 「彩搜搜导航」出现 3 次：点击 5 / 9 / 5 → 保留点击 9 的那条
    const hits = pickRelatedLinks([c("彩搜搜导航", 5), c("彩搜搜导航", 9), c("彩搜搜导航", 5), c("彩搜搜", 7)], "彩搜搜导航站点")
    expect(hits.map((x) => x.title)).toEqual(["彩搜搜导航"])
    // 上限 cap 生效 + 并列点击不改变相对顺序
    const many = [c("ab标题一", 3), c("ab标题二", 3), c("ab标题三", 3)]
    expect(pickRelatedLinks(many, "ab标题", 2).map((x) => x.title)).toEqual(["ab标题一", "ab标题二"])
  })
  it("pickRelatedArticles：标题去重保留首现、createdAt 降序、cap 10", () => {
    const mk = (id: string, title: string, createdAt: string) => ({ id, title, createdAt })
    const rows = [
      mk("1", "重复甲", "2026-01-05T00:00:00"),
      mk("2", "重复甲", "2026-01-09T00:00:00"), // 同名后现 → 丢弃
      mk("3", "重复乙", "2026-01-07T00:00:00"),
      mk("4", "短", "2026-01-08T00:00:00"), // 标题 <2 字符 → 不参与
    ]
    for (let i = 5; i <= 14; i++) rows.push(mk(String(i), `重复丙${i}`, `2026-01-0${(i % 9) + 1}T00:00:00`))
    const got = pickRelatedArticles(rows, "重复")
    expect(got.length).toBe(10)
    expect(got.find((a) => a.id === "2")).toBeUndefined()
    expect(got.find((a) => a.id === "1")).toBeDefined()
    expect(got.find((a) => a.id === "4")).toBeUndefined()
    for (let i = 1; i < got.length; i++) expect(got[i - 1].createdAt >= got[i].createdAt).toBe(true)
  })
  it("pickRelatedLinks 空/短标题防御", () => {
    expect(pickRelatedLinks([{ item: { id: "1", title: "xx" }, clicks: 1 }], "  ")).toEqual([])
  })
})
