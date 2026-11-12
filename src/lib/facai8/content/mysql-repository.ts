// P4：MySqlRepository —— 读 P2 schema 各表（CONTENT_SOURCE=mysql 时由 source.ts 注入 drizzle 实例）
// 与 StaticSnapshotRepository 返回完全相同的 DTO（§9）：
//   - BIGINT 一律字符串（mapper bigToStr；源站 17/18 位 ID 不丢精度）
//   - DATETIME(mode string) 墙钟字符串 → 规范形 T 分隔秒精度（dates.canonFromDb）
//   - 公开内容查询排除软删除（deleted_at IS NULL）与非发布状态（§9.9/9.10）
//   - 排序 = import 写入的 sort_order（稠密排名，§6）+ id 稳定 tiebreak；标签页 = tag_sort_order（migration 0006，
//     标签组内稠密排名，§P8-0）+ id；文章 = publishedAt 降序、id 降序
// P8-1 公开可见性谓词（articlePublic/bulletinPublic/linkPublic/adPublic，契约见 repository.ts 头注释）：
//   在 status/deleted_at 之上叠加发布时间/投放窗口判断，时间比较统一用 DB 时钟 UTC_TIMESTAMP(3)
//   （DATETIME 列按 §11 约定存 UTC 墙钟 → 与 UTC_TIMESTAMP 同基准，应用进程时钟与时区无关）。
// P8-1 搜索/相关推荐：候选取列表规范序后交给 rules.ts 纯函数（与静态侧同一份实现）。
//   MySQL 列使用 utf8mb4_ai_ci（口音不敏感）而 JS includes 大小写敏感、口音敏感 —— SQL LIKE 语义
//   ≠ 静态侧语义，且 %词% 无法走索引；故搜索 = 可见集全量取 title/description/content 后 JS 过滤
//   （快照 3791 链接 / 28 文章量级），两侧命中集合与截断序逐位一致。
// 本模块为纯数据访问层：不含 server-only / 环境变量逻辑，Node 脚本与 vitest 可直接加载（凭据由调用方注入）。
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import type { MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../../db/schema/index.ts"
import {
  ads,
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
import { SEARCH_ARTICLE_LIMIT, SEARCH_LINK_LIMIT } from "./repository.ts"
import type { ArticleQuery, ContentRepository } from "./repository.ts"
import { articleExcerpt, pickRelatedArticles, pickRelatedLinks, searchHit } from "./rules.ts"
import { canonFromDb } from "./dates.ts"
import type {
  AdDto,
  ArticleCategoryDto,
  ArticleDto,
  BulletinDto,
  CatNodeDto,
  IconLibraryDto,
  LineDto,
  LinkDetailDto,
  LinkItemDto,
  LinkMirrorDto,
  MiniArticleDto,
  MiniLinkDto,
  SearchArticleDto,
  SearchLinkDto,
  SearchResults,
  SitePageDto,
  SiteSettingsDto,
  TagDto,
} from "./types.ts"
import type { StaticField } from "../data/site-static.ts"
import { bigToStr, mapArticleCategory } from "./mappers/category-mapper.ts"
import { mapLink, mapLinkDetail, mapLinkMirror } from "./mappers/link-mapper.ts"
import { mapArticle, mapMiniArticle } from "./mappers/article-mapper.ts"
import { mapBulletin } from "./mappers/bulletin-mapper.ts"
import { mapAd } from "./mappers/ad-mapper.ts"
import { mapTag } from "./mappers/tag-mapper.ts"
import { mapLine } from "./mappers/line-mapper.ts"
import { mapIconLibrary, mapSitePage, mapSiteSettings } from "./mappers/settings-mapper.ts"

/** 注入的 Drizzle 实例类型（与 src/lib/db/client.ts 的 AdminDb 同构；此处用相对路径引用 schema 以便 Node 脚本加载） */
export type ContentDb = MySql2Database<typeof schema>

/** 业务 ID（十进制字符串）→ BIGINT；非法输入返回 null（调用方按“查无”处理，不抛错） */
function numId(v: string | null | undefined): bigint | null {
  if (!v || !/^\d+$/.test(v)) return null
  try {
    return BigInt(v)
  } catch {
    return null
  }
}

// ── 公开可见性谓词（P8-1，契约见 repository.ts 头注释；时间窗口判断统一用 DB UTC 时钟）──

const DB_NOW = sql`(UTC_TIMESTAMP(3))`

/** links：已发布 + 未软删（isGone 行仍公开 —— 前台渲染「已失效」徽章，源站分类页同样展示） */
function linkPublic() {
  return and(eq(siteLinks.status, "published"), isNull(siteLinks.deletedAt))
}

/** articles：已发布 + 未软删 + published_at 已到（草稿 / 计划发布行不泄漏） */
function articlePublic() {
  return and(
    eq(articles.status, "published"),
    isNull(articles.deletedAt),
    isNotNull(articles.publishedAt),
    sql`${articles.publishedAt} <= ${DB_NOW}`,
  )
}

/** bulletins：同 articles */
function bulletinPublic() {
  return and(
    eq(bulletins.status, "published"),
    isNull(bulletins.deletedAt),
    isNotNull(bulletins.publishedAt),
    sql`${bulletins.publishedAt} <= ${DB_NOW}`,
  )
}

/** ads：active + 未软删 + 投放窗口覆盖当前（starts_at/ends_at 为空 = 不限） */
function adPublic(position: "home") {
  return and(
    eq(ads.status, "active"),
    isNull(ads.deletedAt),
    eq(ads.position, position),
    sql`(${ads.startsAt} IS NULL OR ${ads.startsAt} <= ${DB_NOW})`,
    sql`(${ads.endsAt} IS NULL OR ${ads.endsAt} >= ${DB_NOW})`,
  )
}

export class MySqlRepository implements ContentRepository {
  readonly source = "mysql" as const

  // 不用 TS 参数属性（private constructor 参数）：Node type-stripping 不支持，而本文件被 Node 脚本直接加载
  private readonly db: ContentDb

  constructor(db: ContentDb) {
    this.db = db
  }

  async getHomeCategories(): Promise<CatNodeDto[]> {
    const rows = await this.db
      .select()
      .from(linkCategories)
      .where(and(isNull(linkCategories.deletedAt), eq(linkCategories.status, "active")))
      .orderBy(asc(linkCategories.parentId), asc(linkCategories.sortOrder), asc(linkCategories.id))
    // MySQL ASC 下 NULL（顶层）排最前；同父内按 (sort_order, id) —— import 写入的序 = 源站数组序（无并列，§6）
    interface RowNode extends Omit<CatNodeDto, "children"> {
      parentId: string | null
    }
    const nodes: RowNode[] = rows.map((r) => ({
      id: bigToStr(r.id) ?? "",
      name: r.name,
      icon: r.iconClass,
      sortOrder: String(r.sortOrder),
      parentId: bigToStr(r.parentId),
    }))
    const tops: CatNodeDto[] = []
    const topById = new Map<string, CatNodeDto>()
    for (const n of nodes) {
      if (n.parentId !== null) continue
      const dto: CatNodeDto = { id: n.id, name: n.name, icon: n.icon, sortOrder: n.sortOrder, children: [] }
      tops.push(dto)
      topById.set(dto.id, dto)
    }
    for (const n of nodes) {
      if (n.parentId === null) continue
      const parent = topById.get(n.parentId)
      if (!parent) continue // 防御：父级缺失（软删/禁用）时不产生孤儿节点
      parent.children.push({ id: n.id, name: n.name, icon: n.icon, sortOrder: n.sortOrder, children: [] })
    }
    return tops
  }

  async getLinksGroupedForHome(): Promise<Record<string, LinkItemDto[]>> {
    // 首页契约（= page.tsx groupLinks()）：源档案序（archive_sort_order，导入期写入快照数组下标）
    // 按 categoryId 追加，不重排、不切片。注意：组内档案序 ≠ (sort_order,id)（45/90 分类实测不同），
    // 必须由 archive_sort_order 复现；后台新建行 NULL 附尾按 id 序
    const rows = await this.db
      .select()
      .from(siteLinks)
      .where(linkPublic())
      .orderBy(sql`${siteLinks.archiveSortOrder} IS NULL`, asc(siteLinks.archiveSortOrder), asc(siteLinks.id))
    const m: Record<string, LinkItemDto[]> = {}
    for (const r of rows) {
      const key = bigToStr(r.categoryId) ?? ""
      const arr = m[key]
      if (arr) arr.push(mapLink(r))
      else m[key] = [mapLink(r)]
    }
    return m
  }

  async getLinksByCategory(categoryId: string): Promise<LinkItemDto[]> {
    const id = numId(categoryId)
    if (id === null) return []
    const rows = await this.db
      .select()
      .from(siteLinks)
      .where(and(eq(siteLinks.categoryId, id), linkPublic()))
      .orderBy(asc(siteLinks.sortOrder), asc(siteLinks.id))
    return rows.map(mapLink)
  }

  async getLinksByTag(tagId: string): Promise<LinkItemDto[]> {
    const id = numId(tagId)
    if (id === null) return []
    const rows = await this.db
      .select()
      .from(siteLinks)
      .where(and(eq(siteLinks.tagId, id), isNull(siteLinks.deletedAt), eq(siteLinks.status, "published")))
      // P8-0：组内稠密排名（tag_sort_order）→ id；未经回填/维护的 NULL rank 行附尾（MySQL ASC 默认 NULL 在最前，显式推后）
      .orderBy(sql`${siteLinks.tagSortOrder} IS NULL`, asc(siteLinks.tagSortOrder), asc(siteLinks.id))
    return rows.map(mapLink)
  }

  async getLinkById(id: string): Promise<LinkItemDto | null> {
    const num = numId(id)
    if (num === null) return null
    const rows = await this.db
      .select()
      .from(siteLinks)
      .where(and(eq(siteLinks.id, num), isNull(siteLinks.deletedAt), eq(siteLinks.status, "published")))
    const row = rows[0]
    return row ? mapLink(row) : null
  }

  async getLinkDetail(id: string): Promise<LinkDetailDto | null> {
    const num = numId(id)
    if (num === null) return null
    // P8 修复（契约补全）：详情可见性继承所属链接——非公开（draft / 停用 / 软删）→ null，
    // 与 getLinkById 同一 linkPublic() 谓词；这条链接行同时用于派生 logoUrl（一次查询两用）。
    const linkRow = (
      await this.db.select().from(siteLinks).where(and(eq(siteLinks.id, num), linkPublic()))
    )[0]
    if (!linkRow) return null
    const dets = await this.db.select().from(siteLinkDetails).where(eq(siteLinkDetails.linkId, num))
    const det = dets[0]
    if (!det) return null // 源站无档 → null，绝不伪造
    // logoUrl / categoryName 在 P2 schema 无独立列：由链接行 / 分类 join 派生
    //（import 时已验证 122 行源站快照值与派生值恒等 → 无损；详情页低频场景，两次查询可接受）
    let categoryName = ""
    const catRow = (await this.db.select().from(linkCategories).where(eq(linkCategories.id, linkRow.categoryId)))[0]
    categoryName = catRow ? catRow.name : ""
    return mapLinkDetail(det, {
      linkId: bigToStr(det.linkId) ?? "",
      logoUrl: linkRow.logoPath,
      categoryName,
    })
  }

  async getLinkMirrors(linkId: string): Promise<LinkMirrorDto[]> {
    const num = numId(linkId)
    if (num === null) return []
    // P8 修复（契约补全）：mirrors 无独立状态列，可见性继承所属链接（repository.ts 头注释）——
    // 非公开链接的备链行不进前台（页面侧虽有 getLinkById 兜底，仓库契约必须自洽）。
    const linkRow = (
      await this.db
        .select({ id: siteLinks.id })
        .from(siteLinks)
        .where(and(eq(siteLinks.id, num), linkPublic()))
    )[0]
    if (!linkRow) return []
    const rows = await this.db
      .select()
      .from(siteLinkMirrors)
      .where(eq(siteLinkMirrors.linkId, num))
      .orderBy(asc(siteLinkMirrors.sortOrder), asc(siteLinkMirrors.id))
    return rows.map(mapLinkMirror)
  }

  async getArticleCategories(): Promise<ArticleCategoryDto[]> {
    const rows = await this.db
      .select()
      .from(articleCategories)
      .where(and(isNull(articleCategories.deletedAt), eq(articleCategories.status, "active")))
      .orderBy(asc(articleCategories.sortOrder), asc(articleCategories.id))
    return rows.map(mapArticleCategory)
  }

  async getArticles(query?: ArticleQuery): Promise<ArticleDto[]> {
    let where = articlePublic()
    if (query?.categoryId) {
      const id = numId(query.categoryId)
      if (id === null) return []
      where = and(where, eq(articles.categoryId, id))
    }
    const rows = await this.db
      .select()
      .from(articles)
      .where(where)
      .orderBy(desc(articles.publishedAt), desc(articles.id))
    return rows.map(mapArticle)
  }

  async getArticleById(id: string): Promise<ArticleDto | null> {
    const num = numId(id)
    if (num === null) return null
    const rows = await this.db.select().from(articles).where(and(eq(articles.id, num), articlePublic()))
    const row = rows[0]
    return row ? mapArticle(row) : null
  }

  async getRelatedLinksForArticle(articleId: string): Promise<LinkItemDto[]> {
    const num = numId(articleId)
    if (num === null) return []
    const art = (await this.db.select({ title: articles.title }).from(articles).where(and(eq(articles.id, num), articlePublic())))[0]
    if (!art) return []
    // 候选 = 公开未失效链接按 (sort_order,id)（= 静态档案序）；clicks LEFT JOIN 详情表（无档 = 0）
    const rows = await this.db
      .select({ link: siteLinks, clicks: sql<number>`coalesce(${siteLinkDetails.clickCount}, 0)` })
      .from(siteLinks)
      .leftJoin(siteLinkDetails, eq(siteLinkDetails.linkId, siteLinks.id))
      .where(and(linkPublic(), eq(siteLinks.isGone, false)))
      .orderBy(asc(siteLinks.sortOrder), asc(siteLinks.id))
    return pickRelatedLinks(
      rows.map((r) => ({ item: mapLink(r.link), clicks: Number(r.clicks) || 0 })),
      art.title,
    )
  }

  async getRelatedArticlesForLink(linkId: string): Promise<ArticleDto[]> {
    const num = numId(linkId)
    if (num === null) return []
    const lk = (await this.db.select({ title: siteLinks.title }).from(siteLinks).where(and(eq(siteLinks.id, num), linkPublic())))[0]
    if (!lk) return []
    // 候选 = 公开文章列表规范序（LONGTEXT 全量载入：快照 28 篇，规则须在 JS 侧与静态侧共用 rules.ts）
    const rows = await this.db
      .select()
      .from(articles)
      .where(articlePublic())
      .orderBy(desc(articles.publishedAt), desc(articles.id))
    return pickRelatedArticles(rows.map(mapArticle), lk.title)
  }

  async searchLinks(query: string): Promise<SearchResults<SearchLinkDto>> {
    const s = query.trim().toLowerCase()
    if (!s) return { items: [], total: 0, truncated: false }
    // title/description 全量取回后 JS 过滤（见文件头：_ai_ci 排序规则 ≠ JS 语义；LIKE %x% 也不走索引）
    // 候选规范序 = 源档案序（archive_sort_order），与静态侧 ALL_LINKS 扫描序逐位一致（截断集合恒等）
    const rows = await this.db
      .select({ link: siteLinks, categoryName: linkCategories.name })
      .from(siteLinks)
      .leftJoin(linkCategories, eq(linkCategories.id, siteLinks.categoryId))
      .where(linkPublic())
      .orderBy(sql`${siteLinks.archiveSortOrder} IS NULL`, asc(siteLinks.archiveSortOrder), asc(siteLinks.id))
    const hits = rows.filter((r) => searchHit(r.link.title, s) || searchHit(r.link.description, s))
    const items = hits
      .slice(0, SEARCH_LINK_LIMIT)
      .map((r) => ({ ...mapLink(r.link), categoryName: r.categoryName ?? "" }))
    return { items, total: hits.length, truncated: hits.length > items.length }
  }

  async searchArticles(query: string): Promise<SearchResults<SearchArticleDto>> {
    const s = query.trim().toLowerCase()
    if (!s) return { items: [], total: 0, truncated: false }
    const [rows, settings] = await Promise.all([
      this.db
        .select()
        .from(articles)
        .where(articlePublic())
        .orderBy(desc(articles.publishedAt), desc(articles.id)),
      this.getSiteSettings(),
    ])
    const hits = rows.filter((a) => searchHit(a.title, s) || searchHit(a.contentHtml, s))
    const items = hits.slice(0, SEARCH_ARTICLE_LIMIT).map((a) => ({
      id: bigToStr(a.id) ?? "",
      title: a.title,
      categoryName: a.categoryNameSnapshot,
      // description = 源站搜索接口快照（site_settings.search_descriptions）优先，缺失回退统一规则
      description: settings.searchDescriptions[bigToStr(a.id) ?? ""] ?? articleExcerpt(a.contentHtml),
      createdAt: canonFromDb(a.publishedAt) ?? canonFromDb(a.createdAt) ?? "",
    }))
    return { items, total: hits.length, truncated: hits.length > items.length }
  }

  async getNewLinks(): Promise<MiniLinkDto[]> {
    // 有详情链接按详情创建时间降序（id 降序 tiebreak）top 10 —— 与静态侧同一规则。
    // P8-1 可见性：innerJoin 限定「已发布 + 未软删」链接 —— 草稿/软删链接的详情行既不占名额也不显示
    const rows = await this.db
      .select({ link: siteLinks })
      .from(siteLinkDetails)
      .innerJoin(siteLinks, and(eq(siteLinks.id, siteLinkDetails.linkId), linkPublic()))
      .orderBy(desc(siteLinkDetails.sourceCreatedAt), desc(siteLinkDetails.linkId))
      .limit(10)
    if (rows.length === 0) return []
    const cats = await this.db.select().from(linkCategories)
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    return rows.map((r) => ({
      id: bigToStr(r.link.id) ?? "",
      title: r.link.title,
      logoUrl: r.link.logoPath,
      url: r.link.url,
      categoryName: catName.get(r.link.categoryId) ?? "",
    }))
  }

  async getRecentLinks(): Promise<MiniLinkDto[]> {
    // 源站 /api/public/recent-links 快照（site_settings.recent_links JSON；import 时按档案序 1:1 存档）。
    // P1 修复：不再原样吐快照——与 getSiteSettings 共用同一过滤/刷新助手（公开可见性 + 当前字段值）。
    const rows = await this.db.select().from(siteSettings)
    const settings = mapSiteSettings(rows)
    return this.filterRecentLinksByCurrent(settings.recentLinks)
  }

  async getNewArticles(): Promise<MiniArticleDto[]> {
    const rows = await this.db
      .select()
      .from(articles)
      .where(articlePublic())
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(8)
    return rows.map(mapMiniArticle)
  }

  async getBulletins(): Promise<BulletinDto[]> {
    const rows = await this.db
      .select()
      .from(bulletins)
      .where(bulletinPublic())
      .orderBy(asc(bulletins.sortOrder), asc(bulletins.id))
    return rows.map(mapBulletin)
  }

  async getBulletinById(id: string): Promise<BulletinDto | null> {
    const num = numId(id)
    if (num === null) return null
    const row = (await this.db.select().from(bulletins).where(and(eq(bulletins.id, num), bulletinPublic())))[0]
    return row ? mapBulletin(row) : null
  }

  async getAds(position: "home" = "home"): Promise<AdDto[]> {
    const rows = await this.db
      .select()
      .from(ads)
      .where(adPublic(position))
      .orderBy(asc(ads.sortOrder), asc(ads.id))
    return rows.map(mapAd)
  }

  async getTags(): Promise<TagDto[]> {
    const rows = await this.db
      .select()
      .from(siteTags)
      .where(and(isNull(siteTags.deletedAt), eq(siteTags.status, "active")))
      .orderBy(asc(siteTags.sortOrder), asc(siteTags.id))
    return rows.map(mapTag)
  }

  async getTagById(tagId: string): Promise<TagDto | null> {
    const num = numId(tagId)
    if (num === null) return null
    const row = (
      await this.db
        .select()
        .from(siteTags)
        .where(and(eq(siteTags.id, num), isNull(siteTags.deletedAt), eq(siteTags.status, "active")))
    )[0]
    return row ? mapTag(row) : null
  }

  async getLines(): Promise<LineDto[]> {
    const rows = await this.db
      .select()
      .from(siteLines)
      .where(and(isNull(siteLines.deletedAt), eq(siteLines.status, "active")))
      .orderBy(asc(siteLines.sortOrder), asc(siteLines.id))
    return rows.map(mapLine)
  }

  async getIconLibraries(): Promise<IconLibraryDto[]> {
    const rows = await this.db
      .select()
      .from(iconLibraries)
      .where(eq(iconLibraries.status, "active"))
      .orderBy(asc(iconLibraries.id))
    return rows.map(mapIconLibrary)
  }

  async getSiteSettings(): Promise<SiteSettingsDto> {
    const rows = await this.db.select().from(siteSettings)
    const dto = mapSiteSettings(rows)
    // P1 修复：recent_links 是源站 JSON 快照（site_settings 行），其中链接可能已被后台
    // 停用 / 软删 / 改名改链 —— 按快照 ID 重读链接当前值并套用公开可见性谓词（与 getRecentLinks 同一助手）。
    dto.recentLinks = await this.filterRecentLinksByCurrent(dto.recentLinks)
    return dto
  }

  /**
   * 「最近更新」快照 → 前台可见集合（P1 修复，getSiteSettings / getRecentLinks 共用）：
   * 保留快照原序；按 ID 单查 site_links（linkPublic() 谓词）+ 分类名 join，
   * 只保留当前仍公开的链接（draft / 停用 / 软删 / 不存在的 ID 被剔除），
   * 且 title/url/logoUrl/categoryName 一律取数据库当前值（快照字段仅作 ID 与顺序载体）。
   * 静态侧无需此过滤：档案 = 发布态快照（repository.ts 头注释既有条款）。
   */
  private async filterRecentLinksByCurrent(snapshot: MiniLinkDto[]): Promise<MiniLinkDto[]> {
    const uniqueIds = [...new Set(snapshot.map((m) => m.id))]
    if (uniqueIds.length === 0) return []
    const nums = uniqueIds.map((v) => numId(v)).filter((v): v is bigint => v !== null)
    if (nums.length === 0) return []
    const rows = await this.db
      .select({
        id: siteLinks.id,
        title: siteLinks.title,
        url: siteLinks.url,
        logoPath: siteLinks.logoPath,
        categoryName: linkCategories.name,
      })
      .from(siteLinks)
      .leftJoin(linkCategories, eq(linkCategories.id, siteLinks.categoryId))
      .where(and(inArray(siteLinks.id, nums), linkPublic()))
    const live = new Map(rows.map((r) => [bigToStr(r.id) ?? "", r]))
    return snapshot
      .filter((m) => live.has(m.id))
      .map((m) => {
        const r = live.get(m.id)!
        return {
          id: m.id,
          title: r.title,
          logoUrl: r.logoPath,
          url: r.url,
          categoryName: r.categoryName ?? "",
        }
      })
  }

  async getSitePage(pageKey: StaticField): Promise<SitePageDto | null> {
    const rows = await this.db.select().from(sitePages).where(eq(sitePages.pageKey, pageKey))
    const row = rows[0]
    return row ? mapSitePage(row) : null
  }
}
