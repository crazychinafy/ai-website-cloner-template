// P8-1 测试 3：公开可见性统一契约（MySQL 侧谓词，scratch 播种行驱动）
// 静态档案全部是发布态快照（无草稿/未来/软删行），可见性差异只能在 MySQL 侧用播种行证明：
//   - links：draft / 软删行不泄漏；isGone 行必须保持可见（前台「已失效」徽章语义）
//   - articles / bulletins：draft、published_at 未来（计划发布）、软删行不泄漏；到点行立即可见
//   - ads：非 active 状态、窗口未到 / 已过、软删行不泄漏；NULL 窗口 = 长期投放
//   - 搜索 / 相关推荐 / 首页分组 / 最新榜单同样吃可见性（草稿词搜不到、失效链接不进相关推荐）
// 时间判断基准 = 数据库 UTC 时钟（UTC_TIMESTAMP(3)），播种与断言同一时钟，无应用时区偏差。
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { setupP8Scratch, teardownP8Scratch, importP8Snapshot, p8MysqlRepo } from "./p8-harness"
import { articleExcerpt } from "../../src/lib/facai8/content/rules"

// ── 播种行 ID（91 开头，与雪花 ID 档案行段隔离，afterAll 删库自然清理）──
const L_NOW = "910000000000000001"
const L_DRAFT = "910000000000000002"
const L_SOFT = "910000000000000003"
const L_GONE = "910000000000000004"
const L_GONE_REL = "910000000000000005"
const L_OK_REL = "910000000000000006"
const L_DET = "910000000000000007"
const A_PUB = "910000000000000011"
const A_DRAFT = "910000000000000012"
const A_FUTURE = "910000000000000013"
const A_SOFT = "910000000000000014"
const A_REL_GONE = "910000000000000015"
const A_REL_OK = "910000000000000016"
const A_REL_LINK = "910000000000000017"
const B_PUB = "910000000000000021"
const B_DRAFT = "910000000000000022"
const B_FUTURE = "910000000000000023"
const B_SOFT = "910000000000000024"
const AD_WINDOW = "910000000000000031"
const AD_OPEN = "910000000000000032"
const AD_EXPIRED = "910000000000000033"
const AD_FUTURE = "910000000000000034"
const AD_DRAFT = "910000000000000035"
const AD_SOFT = "910000000000000036"

let pool: Pool
let repo: ReturnType<typeof p8MysqlRepo>
let linkCatId: string
let artCatId: string

async function seed(): Promise<void> {
  const [cats] = await pool.query("SELECT CAST(id AS CHAR) AS id FROM link_categories ORDER BY id LIMIT 1")
  linkCatId = (cats as { id: string }[])[0].id
  const [acats] = await pool.query("SELECT CAST(id AS CHAR) AS id FROM article_categories ORDER BY id LIMIT 1")
  artCatId = (acats as { id: string }[])[0].id

  const linkIns = (id: string, title: string, desc: string, extra: string): Promise<unknown> =>
    pool.query(
      `INSERT INTO site_links (id, category_id, title, url, description, logo_path, status, sort_order, source_snapshot)
       VALUES ('${id}', '${linkCatId}', '${title}', 'https://p8-visibility.example/${id}', ?, '', 'published', ${900000 + Number(id.slice(-2))}, 0)`,
      [desc],
    ).then(() => pool.query(`UPDATE site_links SET ${extra} WHERE id = '${id}'`))

  await linkIns(L_NOW, "P8VisAlphaNow", "p8vislinknow 可见性探针", "is_gone = 0")
  await linkIns(L_DRAFT, "P8VisBetaDraft", "p8vislinkdraft 草稿探针", "status = 'draft'")
  await linkIns(L_SOFT, "P8VisGammaSoft", "p8vislinksoft 软删探针", "deleted_at = UTC_TIMESTAMP(3)")
  await linkIns(L_GONE, "P8VisDeltaGone", "p8vislinkgone 失效探针", "is_gone = 1")
  await linkIns(L_GONE_REL, "P8RelatedGoneOnlySite乙站", "p8vislinkgonerel 相关推荐失效候选", "is_gone = 1")
  await linkIns(L_OK_REL, "P8RelatedOkSite丙站", "p8vislinkokrel 相关推荐正常候选", "is_gone = 0")
  await linkIns(L_DET, "P8VisNewListDraft", "p8vislinkdet 最新榜单草稿", "status = 'draft'")
  await pool.query(
    `INSERT INTO site_link_details (link_id, click_count, like_count, annotation, preview_image, detail_html, source_created_at)
     VALUES ('${L_DET}', 0, 0, '', '', '<p>p8 detail</p>', '2099-01-01 00:00:00.000')`,
  )

  const artIns = (id: string, title: string, content: string, status: string, pubExpr: string, deleted = false): Promise<unknown> =>
    pool.query(
      `INSERT INTO articles (id, category_id, title, content_html, status, published_at${deleted ? ", deleted_at" : ""})
       VALUES ('${id}', '${artCatId}', '${title}', ?, '${status}', ${pubExpr}${deleted ? ", UTC_TIMESTAMP(3)" : ""})`,
      [content],
    )

  await artIns(A_PUB, "P8PubArticleProbe", "<p>正文 p8visartpub 内容</p>", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND")
  await artIns(A_DRAFT, "P8DraftArticleProbe", "<p>正文 p8visartdraft 内容</p>", "draft", "NULL")
  await artIns(A_FUTURE, "P8FutureArticleProbe", "<p>正文 p8visartfuture 内容</p>", "published", "UTC_TIMESTAMP(3) + INTERVAL 7 DAY")
  await artIns(A_SOFT, "P8SoftArticleProbe", "<p>正文 p8visartsoft 内容</p>", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND", true)
  await artIns(A_REL_GONE, "P8RelatedGoneOnlySite乙站", "<p>相关推荐失效测试</p>", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND")
  await artIns(A_REL_OK, "P8RelatedOkSite丙站", "<p>相关推荐正常测试</p>", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND")
  await artIns(A_REL_LINK, "P8VisAlphaNow", "<p>站点详情相关文章测试</p>", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND")

  const bulIns = (id: string, title: string, status: string, pubExpr: string, deleted = false): Promise<unknown> =>
    pool.query(
      `INSERT INTO bulletins (id, title, content_html, status, sort_order, published_at${deleted ? ", deleted_at" : ""})
       VALUES ('${id}', ?, '<p>p8 bulletin</p>', '${status}', 900000 + ${Number(id.slice(-2))}, ${pubExpr}${deleted ? ", UTC_TIMESTAMP(3)" : ""})`,
      [title],
    )
  await bulIns(B_PUB, "P8公告甲", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND")
  await bulIns(B_DRAFT, "P8公告乙", "draft", "NULL")
  await bulIns(B_FUTURE, "P8公告丙", "published", "UTC_TIMESTAMP(3) + INTERVAL 7 DAY")
  await bulIns(B_SOFT, "P8公告丁", "published", "UTC_TIMESTAMP(3) - INTERVAL 60 SECOND", true)

  const adIns = (id: string, status: string, starts: string, ends: string, deleted = false): Promise<unknown> =>
    pool.query(
      `INSERT INTO ads (id, position, title, target_url, image_path, status, sort_order, starts_at, ends_at${deleted ? ", deleted_at" : ""})
       VALUES ('${id}', 'home', ?, 'https://p8-visibility.example/ad', '/ads/p8.png', '${status}', 900000 + ${Number(id.slice(-2))}, ${starts}, ${ends}${deleted ? ", UTC_TIMESTAMP(3)" : ""})`,
      [`P8广告${id.slice(-2)}`],
    )
  await adIns(AD_WINDOW, "active", "UTC_TIMESTAMP(3) - INTERVAL 1 DAY", "UTC_TIMESTAMP(3) + INTERVAL 1 DAY")
  await adIns(AD_OPEN, "active", "NULL", "NULL")
  await adIns(AD_EXPIRED, "active", "UTC_TIMESTAMP(3) - INTERVAL 7 DAY", "UTC_TIMESTAMP(3) - INTERVAL 1 DAY")
  await adIns(AD_FUTURE, "active", "UTC_TIMESTAMP(3) + INTERVAL 1 DAY", "UTC_TIMESTAMP(3) + INTERVAL 7 DAY")
  await adIns(AD_DRAFT, "draft", "NULL", "NULL")
  await adIns(AD_SOFT, "active", "NULL", "NULL", true)
}

beforeAll(async () => {
  pool = await setupP8Scratch()
  const res = await importP8Snapshot("p8-vis-test")
  if (res.outcome !== "imported" && res.outcome !== "no_op") throw new Error(`setup import failed: ${res.outcome} ${res.error}`)
  await seed()
  repo = p8MysqlRepo(pool)
}, 180_000)

afterAll(async () => {
  await teardownP8Scratch(pool)
})

describe("links 可见性", () => {
  it("分类列表：published 可见、draft / 软删不可见、isGone 可见（徽章语义）", async () => {
    const ids = (await repo.getLinksByCategory(linkCatId)).map((l) => l.id)
    expect(ids).toContain(L_NOW)
    expect(ids).toContain(L_GONE)
    expect(ids).not.toContain(L_DRAFT)
    expect(ids).not.toContain(L_SOFT)
  })
  it("getLinkById：draft / 软删 → null；isGone 行 isGone === 1", async () => {
    expect(await repo.getLinkById(L_NOW)).not.toBeNull()
    expect(await repo.getLinkById(L_DRAFT)).toBeNull()
    expect(await repo.getLinkById(L_SOFT)).toBeNull()
    const gone = await repo.getLinkById(L_GONE)
    expect(gone).not.toBeNull()
    expect(gone!.isGone).toBe(1)
  })
  it("首页分组：不可见行在拍平结果里彻底消失", async () => {
    const grouped = await repo.getLinksGroupedForHome()
    const flat = new Set(Object.values(grouped).flat().map((l) => l.id))
    expect(flat.has(L_NOW)).toBe(true)
    expect(flat.has(L_GONE)).toBe(true)
    expect(flat.has(L_DRAFT)).toBe(false)
    expect(flat.has(L_SOFT)).toBe(false)
  })
  it("searchLinks：草稿 / 软删词 0 命中；失效链接仍可搜到（与静态侧同语义）", async () => {
    expect((await repo.searchLinks("p8vislinkdraft")).total).toBe(0)
    expect((await repo.searchLinks("p8vislinksoft")).total).toBe(0)
    const now = await repo.searchLinks("p8vislinknow")
    expect(now.total).toBe(1)
    expect(now.items[0].id).toBe(L_NOW)
    expect((await repo.searchLinks("p8vislinkgone 失效探针")).total).toBe(1)
  })
})

describe("articles 可见性（草稿 / 计划发布 / 软删不泄漏）", () => {
  it("getArticles 列表过滤", async () => {
    const ids = (await repo.getArticles()).map((a) => a.id)
    expect(ids).toContain(A_PUB)
    expect(ids).not.toContain(A_DRAFT)
    expect(ids).not.toContain(A_FUTURE)
    expect(ids).not.toContain(A_SOFT)
  })
  it("getArticleById：草稿 / 未来 / 软删 → null", async () => {
    expect(await repo.getArticleById(A_PUB)).not.toBeNull()
    expect(await repo.getArticleById(A_DRAFT)).toBeNull()
    expect(await repo.getArticleById(A_FUTURE)).toBeNull()
    expect(await repo.getArticleById(A_SOFT)).toBeNull()
  })
  it("searchArticles：草稿 / 未来 / 软删正文 0 命中；可见行摘要 = articleExcerpt 回退（无快照条目）", async () => {
    for (const q of ["p8visartdraft", "p8visartfuture", "p8visartsoft"]) expect((await repo.searchArticles(q)).total).toBe(0)
    const hit = await repo.searchArticles("p8visartpub")
    expect(hit.total).toBe(1)
    expect(hit.items[0].id).toBe(A_PUB)
    expect(hit.items[0].description).toBe(articleExcerpt("<p>正文 p8visartpub 内容</p>"))
  })
  it("getNewArticles 榜单：草稿 / 未来不进 top8，已到点行进入", async () => {
    const top8 = await repo.getNewArticles()
    const ids = top8.map((a) => a.id)
    expect(ids).toContain(A_PUB)
    expect(ids).not.toContain(A_DRAFT)
    expect(ids).not.toContain(A_FUTURE)
    expect(ids).not.toContain(A_SOFT)
  })
})

describe("bulletins / ads 可见性", () => {
  it("getBulletins / getBulletinById", async () => {
    const ids = (await repo.getBulletins()).map((b) => b.id)
    expect(ids).toContain(B_PUB)
    expect(ids).not.toContain(B_DRAFT)
    expect(ids).not.toContain(B_FUTURE)
    expect(ids).not.toContain(B_SOFT)
    expect(await repo.getBulletinById(B_PUB)).not.toBeNull()
    expect(await repo.getBulletinById(B_FUTURE)).toBeNull()
  })
  it("getAds：窗口内 / 无窗口可见；已过 / 未到 / 非 active / 软删不可见", async () => {
    const ids = (await repo.getAds("home")).map((a) => a.id)
    expect(ids).toContain(AD_WINDOW)
    expect(ids).toContain(AD_OPEN)
    expect(ids).not.toContain(AD_EXPIRED)
    expect(ids).not.toContain(AD_FUTURE)
    expect(ids).not.toContain(AD_DRAFT)
    expect(ids).not.toContain(AD_SOFT)
  })
})

describe("相关推荐尊重可见性", () => {
  it("文章相关网址：失效链接（isGone=1）不入选，正常链接入选", async () => {
    const goneOnly = await repo.getRelatedLinksForArticle(A_REL_GONE)
    expect(goneOnly.map((l) => l.id)).not.toContain(L_GONE_REL)
    const ok = await repo.getRelatedLinksForArticle(A_REL_OK)
    expect(ok.map((l) => l.id)).toContain(L_OK_REL)
    expect(ok.every((l) => l.isGone !== 1)).toBe(true)
  })
  it("站点相关文章：只从可见文章里选（草稿 / 未来标题不出现）", async () => {
    const rel = await repo.getRelatedArticlesForLink(L_NOW)
    const ids = rel.map((a) => a.id)
    expect(ids).toContain(A_REL_LINK)
    expect(ids).not.toContain(A_DRAFT)
    expect(ids).not.toContain(A_FUTURE)
    expect(ids).not.toContain(A_SOFT)
  })
})

describe("后台运营 → 前台可见 生命周期（状态迁移后立即生效）", () => {
  it("getNewLinks：草稿链接的详情行不占名额；发布后立即登顶（详情创建时间最新）", async () => {
    const before = await repo.getNewLinks()
    expect(before).toHaveLength(10)
    expect(before.map((l) => l.id)).not.toContain(L_DET)
    await pool.query("UPDATE site_links SET status = 'published' WHERE id = ?", [L_DET])
    const after = await repo.getNewLinks()
    expect(after[0].id).toBe(L_DET)
  })
  it("文章 草稿→发布：getArticleById / 搜索 / 榜单立即可见", async () => {
    expect(await repo.getArticleById(A_DRAFT)).toBeNull()
    await pool.query("UPDATE articles SET status = 'published', published_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [A_DRAFT])
    expect(await repo.getArticleById(A_DRAFT)).not.toBeNull()
    expect((await repo.searchArticles("p8visartdraft")).total).toBe(1)
    expect((await repo.getNewArticles()).map((a) => a.id)).toContain(A_DRAFT)
  })
  it("文章 计划发布到点：published_at 落后于当前后立即可见", async () => {
    expect(await repo.getArticleById(A_FUTURE)).toBeNull()
    await pool.query("UPDATE articles SET published_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [A_FUTURE])
    expect(await repo.getArticleById(A_FUTURE)).not.toBeNull()
  })
  it("公告 计划发布到点：列表与详情立即可见", async () => {
    expect(await repo.getBulletinById(B_FUTURE)).toBeNull()
    await pool.query("UPDATE bulletins SET published_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [B_FUTURE])
    expect(await repo.getBulletinById(B_FUTURE)).not.toBeNull()
    expect((await repo.getBulletins()).map((b) => b.id)).toContain(B_FUTURE)
  })
  it("广告 过期 / 未开始 → 续期窗口后立即可见", async () => {
    expect((await repo.getAds("home")).map((a) => a.id)).not.toContain(AD_FUTURE)
    await pool.query("UPDATE ads SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [AD_FUTURE])
    expect((await repo.getAds("home")).map((a) => a.id)).toContain(AD_FUTURE)
  })
})
