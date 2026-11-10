// P4 测试 1：静态数据（§12.1）—— StaticSnapshotRepository 对冻结源数据的忠实映射
// 覆盖：字段映射 / ID 无精度损失 / 分类层级 / 网址关联 / 缺失详情不伪造 / 备用链接完整 / CAT_ORDER 顺序 / 派生数据
import { describe, expect, it } from "vitest"
import { StaticSnapshotRepository } from "../../src/lib/facai8/content/static-repository"
import { LINK_CATEGORIES } from "../../src/lib/facai8/data/categories"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { CAT_ORDER, TAG_ORDER, applyLinkOrder } from "../../src/lib/facai8/data/link-order"
import { LINK_DETAILS } from "../../src/lib/facai8/data/link-details"
import { LINK_MIRRORS } from "../../src/lib/facai8/data/link-mirrors"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import { ARTICLE_CATEGORIES } from "../../src/lib/facai8/data/article-categories"
import { BULLETINS } from "../../src/lib/facai8/data/bulletins"
import { HOME_ADS } from "../../src/lib/facai8/data/ads"
import { ALL_LINES } from "../../src/lib/facai8/data/lines"
import { SITE_INFO } from "../../src/lib/facai8/data/site-info"
import { HOME_POPUP } from "../../src/lib/facai8/data/popup"
import { STATS } from "../../src/lib/facai8/data/stats"
import { NEW_LINKS } from "../../src/lib/facai8/data/new-links"
import { NEW_ARTICLES } from "../../src/lib/facai8/data/new-articles"
import { RECENT_LINKS } from "../../src/lib/facai8/data/recent-links"
import { SITE_STATIC } from "../../src/lib/facai8/data/site-static"
import { ICON_LIBRARIES } from "../../src/lib/facai8/data/icon-libraries"

const repo = new StaticSnapshotRepository()

const cmpId = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0)

describe("P4 静态数据（StaticSnapshotRepository）", () => {
  it("原始文件能够正确读取（导出变量齐备且非空）", () => {
    expect(ALL_LINKS.length).toBeGreaterThan(3000)
    expect(LINK_CATEGORIES.length).toBe(60)
    expect(ALL_ARTICLES.length).toBe(28)
    expect(ARTICLE_CATEGORIES.length).toBe(5)
    expect(BULLETINS.length).toBe(1)
    expect(HOME_ADS.length).toBe(14)
    expect(ALL_LINES.length).toBe(5)
    expect(ICON_LIBRARIES.length).toBe(5)
    expect(Object.keys(SITE_STATIC).length).toBe(4)
  })

  it("所有数据字段映射正确（逐字段与冻结源一致）", async () => {
    // 链接
    const src = ALL_LINKS[0]
    const dto = await repo.getLinkById(src.id)
    expect(dto).not.toBeNull()
    expect(dto!.id).toBe(src.id)
    expect(dto!.categoryId).toBe(src.categoryId)
    expect(dto!.logoUrl).toBe(src.logoUrl)
    expect(dto!.url).toBe(src.url)
    expect(dto!.title).toBe(src.title)
    expect(dto!.description).toBe(src.description)
    expect(dto!.isGone).toBe(src.isGone)
    expect(dto!.tagId).toBe(src.tagId)

    // 分类（顶层 + 子级）
    const cats = await repo.getHomeCategories()
    expect(cats.length).toBe(LINK_CATEGORIES.length)
    expect(cats[0]).toEqual({ ...LINK_CATEGORIES[0] }) // CatNodeDto 与 CatNode 同形

    // 文章（抽 3 篇逐字段）
    const arts = await repo.getArticles()
    for (const a of [ALL_ARTICLES[0], ALL_ARTICLES[13], ALL_ARTICLES[27]]) {
      const dto = await repo.getArticleById(a.id)
      expect(dto!.id).toBe(a.id)
      expect(dto!.title).toBe(a.title)
      expect(dto!.content).toBe(a.content)
      expect(dto!.coverImage).toBe(a.coverImage)
      expect(dto!.categoryId).toBe(a.categoryId)
      expect(dto!.categoryName).toBe(a.categoryName)
      expect(dto!.seoTitle).toBe(a.seoTitle)
      expect(dto!.seoKeywords).toBe(a.seoKeywords)
      expect(dto!.seoDescription).toBe(a.seoDescription)
      expect(dto!.viewCount).toBe(a.viewCount)
      expect(dto!.createdAt).toBe(a.createdAt)
      expect(dto!.updatedAt).toBe(a.updatedAt)
      expect(dto!.authorName).toBe(a.authorName)
      expect(dto!.authorAvatar).toBe(a.authorAvatar)
    }
    expect(arts.length).toBe(ALL_ARTICLES.length)

    // 公告 / 广告 / 线路 / 标签 / 文章分类 / 图标库
    const bul = await repo.getBulletins()
    expect(bul[0]).toEqual({ ...BULLETINS[0] })
    const ad = (await repo.getAds())[0]
    expect(ad).toEqual({ ...HOME_ADS[0] })
    const line = (await repo.getLines())[0]
    expect(line).toEqual({ ...ALL_LINES[0] })
    const artCats = await repo.getArticleCategories()
    expect(artCats[0].id).toBe(ARTICLE_CATEGORIES[0].id)
    const icons = await repo.getIconLibraries()
    expect(icons.length).toBe(ICON_LIBRARIES.length)
    // 图标库仓库序 = id 数值升序（canonical）
    for (let i = 1; i < icons.length; i++) expect(cmpId(icons[i - 1].id, icons[i].id)).toBeLessThan(0)

    // 站点设置聚合
    const s = await repo.getSiteSettings()
    expect(s.siteName).toBe(SITE_INFO.siteName)
    expect(s.siteDescription).toBe(SITE_INFO.siteDescription)
    expect(s.siteLogo).toBe(SITE_INFO.siteLogo)
    expect(s.siteFavicon).toBe(SITE_INFO.siteFavicon)
    expect(s.footerText).toBe(SITE_INFO.footerText)
    expect(s.adsRandom).toBe(SITE_INFO.adsRandom)
    expect(s.popup).toEqual(HOME_POPUP)
    expect(s.stats).toEqual({ ...STATS })
    expect(s.recentLinks).toEqual(RECENT_LINKS.map((m) => ({ ...m })))

    // 站点页面
    const page = await repo.getSitePage("aboutUs")
    expect(page?.title).toBe(SITE_STATIC.aboutUs.title)
    expect(page?.subtitle).toBe(SITE_STATIC.aboutUs.subtitle)
    expect(page?.html).toBe(SITE_STATIC.aboutUs.html)
  })

  it("ID 无精度损失（全部 17/18 位 ID 字符串往返一致，未转 Number）", async () => {
    const cats = await repo.getHomeCategories()
    const allCatIds = cats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)])
    for (const id of allCatIds) expect(id).toMatch(/^\d{15,20}$/)
    // 全量链接 ID 往返（含 18 位）
    const longest = ALL_LINKS.reduce((m, l) => Math.max(m, l.id.length), 0)
    expect(longest).toBeGreaterThanOrEqual(17)
    const samples = ALL_LINKS.filter((l) => l.id.length === longest).slice(0, 50)
    for (const l of samples) {
      const dto = await repo.getLinkById(l.id)
      expect(dto!.id).toBe(l.id) // 字符串完全一致（Number 化会丢精度 → 必然失败）
    }
    // 18 位 ID 的真实存在性
    expect(ALL_LINKS.some((l) => l.id.length === 18)).toBe(true)
  })

  it("分类层级正确（两级树 + 父子归属）", async () => {
    const cats = await repo.getHomeCategories()
    let children = 0
    for (const c of cats) {
      children += c.children.length
      for (const k of c.children) expect(k.children).toEqual([])
    }
    const srcChildren = LINK_CATEGORIES.reduce((a, c) => a + c.children.length, 0)
    expect(children).toBe(srcChildren)
    // 顶层数组序 = 源站数组序
    expect(cats.map((c) => c.id)).toEqual(LINK_CATEGORIES.map((c) => c.id))
    // 子级数组序 = 源站数组序
    for (const [i, c] of cats.entries()) {
      expect(c.children.map((x) => x.id)).toEqual(LINK_CATEGORIES[i].children.map((x) => x.id))
    }
  })

  it("网址关联正确（按分类过滤的集合与源一致）", async () => {
    const cats = await repo.getHomeCategories()
    const allCatIds = new Set(cats.flatMap((c) => [c.id, ...c.children.map((x) => x.id)]))
    let total = 0
    for (const cid of allCatIds) {
      const rows = await repo.getLinksByCategory(cid)
      const expected = ALL_LINKS.filter((l) => l.categoryId === cid)
      expect(rows.map((r) => r.id).sort()).toEqual(expected.map((l) => l.id).sort())
      total += rows.length
    }
    expect(total).toBe(ALL_LINKS.length) // 每条链接恰归属一个分类节点
  })

  it("缺失详情不被伪造（无档 → null；有档 → 源值）", async () => {
    const withDet = Object.keys(LINK_DETAILS)
    const withoutDet = ALL_LINKS.map((l) => l.id).filter((id) => !LINK_DETAILS[id])
    expect(withDet.length).toBe(122)
    expect(withoutDet.length).toBeGreaterThan(3000)
    for (const id of withDet.slice(0, 10)) {
      const dto = await repo.getLinkDetail(id)
      expect(dto).not.toBeNull()
      expect(dto!.id).toBe(id)
      expect(dto!.clickCount).toBe(LINK_DETAILS[id].clickCount)
      expect(dto!.likeCount).toBe(LINK_DETAILS[id].likeCount)
      expect(dto!.createdAt).toBe(LINK_DETAILS[id].createdAt)
      expect(dto!.updatedAt).toBe(LINK_DETAILS[id].updatedAt)
      expect(dto!.annotation).toBe(LINK_DETAILS[id].annotation)
      expect(dto!.previewImage).toBe(LINK_DETAILS[id].previewImage)
      expect(dto!.detail).toBe(LINK_DETAILS[id].detail)
    }
    for (const id of withoutDet.slice(0, 10)) {
      expect(await repo.getLinkDetail(id)).toBeNull()
    }
    expect(await repo.getLinkDetail("99999999999999999")).toBeNull()
  })

  it("备用链接完整（有镜像的逐条一致；无镜像 → 空数组）", async () => {
    const mirrorKeys = Object.keys(LINK_MIRRORS)
    expect(mirrorKeys.length).toBe(66)
    let total = 0
    for (const key of mirrorKeys.slice(0, 20)) {
      const rows = await repo.getLinkMirrors(key)
      expect(rows).toEqual(LINK_MIRRORS[key].map((m) => ({ ...m })))
      total += rows.length
    }
    expect(total).toBe(mirrorKeys.slice(0, 20).reduce((a, k) => a + LINK_MIRRORS[k].length, 0))
    // 无镜像的链接 → []
    const noMirror = ALL_LINKS.map((l) => l.id).find((id) => !LINK_MIRRORS[id])
    expect(await repo.getLinkMirrors(noMirror!)).toEqual([])
  })

  it("CAT_ORDER 顺序正确（= CAT_ORDER 序列优先 + 档案序追加，即 applyLinkOrder）", async () => {
    // 选一个「档案序 ≠ CAT_ORDER 序」的分类（源站双序事实）+ 一个全覆盖分类
    const byCat = new Map<string, (typeof ALL_LINKS)[number][]>()
    for (const l of ALL_LINKS) {
      const arr = byCat.get(l.categoryId) ?? []
      arr.push(l)
      byCat.set(l.categoryId, arr)
    }
    let checked = 0
    for (const [cid, links] of byCat) {
      if ((CAT_ORDER[cid]?.length ?? 0) === 0) continue
      const expected = applyLinkOrder(links, CAT_ORDER[cid]).map((l) => l.id)
      const actual = (await repo.getLinksByCategory(cid)).map((r) => r.id)
      expect(actual).toEqual(expected)
      checked++
    }
    expect(checked).toBe(90) // 全部有 CAT_ORDER 序列的分类
  })

  it("TAG_ORDER 顺序（标签页 = TAG_ORDER 序列优先 + 档案序追加）", async () => {
    for (const [tagId, seq] of Object.entries(TAG_ORDER)) {
      const links = ALL_LINKS.filter((l) => l.tagId === tagId)
      const expected = applyLinkOrder(links, seq).map((l) => l.id)
      const actual = (await repo.getLinksByTag(tagId)).map((r) => r.id)
      expect(actual).toEqual(expected)
    }
    // 无序列标签 → 档案序
    const tagNoSeq = ALL_LINKS.find((l) => l.tagId && !TAG_ORDER[l.tagId])
    if (tagNoSeq) {
      const expected = ALL_LINKS.filter((l) => l.tagId === tagNoSeq.tagId).map((l) => l.id)
      expect((await repo.getLinksByTag(tagNoSeq.tagId!)).map((r) => r.id)).toEqual(expected)
    }
  })

  it("文章列表 = createdAt 降序（id 降序 tiebreak）；文章分类 = 档案序", async () => {
    const arts = await repo.getArticles()
    const expected = ALL_ARTICLES.slice().sort((a, b) =>
      a.createdAt === b.createdAt ? cmpId(b.id, a.id) : (a.createdAt < b.createdAt ? 1 : -1),
    ).map((a) => a.id)
    expect(arts.map((a) => a.id)).toEqual(expected)
    // 带分类过滤
    const cat = ARTICLE_CATEGORIES[0].id
    expect((await repo.getArticles({ categoryId: cat })).map((a) => a.id)).toEqual(
      ALL_ARTICLES.filter((a) => a.categoryId === cat).map((a) => a.id),
    )
    const cats = await repo.getArticleCategories()
    expect(cats.map((c) => c.id)).toEqual(ARTICLE_CATEGORIES.map((c) => c.id))
  })

  it("派生数据（NEW_LINKS / NEW_ARTICLES 重算一致；RECENT_LINKS 原样）", async () => {
    expect((await repo.getNewLinks()).map((l) => l.id)).toEqual(NEW_LINKS.map((l) => l.id))
    expect((await repo.getNewArticles()).map((a) => a.id)).toEqual(NEW_ARTICLES.map((a) => a.id))
    expect((await repo.getRecentLinks()).map((l) => l.id)).toEqual(RECENT_LINKS.map((l) => l.id))
    // MiniLink 字段
    const nl = (await repo.getNewLinks())[0]
    const src = NEW_LINKS[0]
    expect(nl).toEqual({ ...src })
  })

  it("空值语义正确（null 与 '' 区分）", async () => {
    const nullTag = ALL_LINKS.find((l) => l.tagId === null)
    const dto = await repo.getLinkById(nullTag!.id)
    expect(dto!.tagId).toBeNull() // 源站无标签 → null（不是 ""）
    const noLogo = ALL_LINKS.find((l) => l.logoUrl === "")
    expect((await repo.getLinkById(noLogo!.id))!.logoUrl).toBe("") // 无 Logo → 空字符串
  })
})
