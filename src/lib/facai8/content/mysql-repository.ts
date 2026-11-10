// P4：MySqlRepository —— 读 P2 schema 各表（CONTENT_SOURCE=mysql 时由 source.ts 注入 drizzle 实例）
// 与 StaticSnapshotRepository 返回完全相同的 DTO（§9）：
//   - BIGINT 一律字符串（mapper bigToStr；源站 17/18 位 ID 不丢精度）
//   - DATETIME(mode string) 墙钟字符串 → 规范形 T 分隔秒精度（dates.canonFromDb）
//   - 公开内容查询排除软删除（deleted_at IS NULL）与非发布状态（§9.9/9.10）
//   - 排序 = import 写入的 sort_order（稠密排名，§6）+ id 稳定 tiebreak；文章 = publishedAt 降序、id 降序
// 本模块为纯数据访问层：不含 server-only / 环境变量逻辑，Node 脚本与 vitest 可直接加载（凭据由调用方注入）。
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
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
import type { ArticleQuery, ContentRepository } from "./repository.ts"
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

  async getLinksByCategory(categoryId: string): Promise<LinkItemDto[]> {
    const id = numId(categoryId)
    if (id === null) return []
    const rows = await this.db
      .select()
      .from(siteLinks)
      .where(and(eq(siteLinks.categoryId, id), isNull(siteLinks.deletedAt), eq(siteLinks.status, "published")))
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
      .orderBy(asc(siteLinks.sortOrder), asc(siteLinks.id))
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
    const dets = await this.db.select().from(siteLinkDetails).where(eq(siteLinkDetails.linkId, num))
    const det = dets[0]
    if (!det) return null // 源站无档 → null，绝不伪造
    // logoUrl / categoryName 在 P2 schema 无独立列：由链接行 / 分类 join 派生
    //（import 时已验证 122 行源站快照值与派生值恒等 → 无损；详情页低频场景，两次查询可接受）
    const linkRow = (await this.db.select().from(siteLinks).where(eq(siteLinks.id, num)))[0]
    let categoryName = ""
    if (linkRow) {
      const catRow = (await this.db.select().from(linkCategories).where(eq(linkCategories.id, linkRow.categoryId)))[0]
      categoryName = catRow ? catRow.name : ""
    }
    return mapLinkDetail(det, {
      linkId: bigToStr(det.linkId) ?? "",
      logoUrl: linkRow ? linkRow.logoPath : "",
      categoryName,
    })
  }

  async getLinkMirrors(linkId: string): Promise<LinkMirrorDto[]> {
    const num = numId(linkId)
    if (num === null) return []
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
    const conds = [isNull(articles.deletedAt), eq(articles.status, "published")]
    if (query?.categoryId) {
      const id = numId(query.categoryId)
      if (id === null) return []
      conds.push(eq(articles.categoryId, id))
    }
    const rows = await this.db
      .select()
      .from(articles)
      .where(and(...conds))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
    return rows.map(mapArticle)
  }

  async getArticleById(id: string): Promise<ArticleDto | null> {
    const num = numId(id)
    if (num === null) return null
    const rows = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.id, num), isNull(articles.deletedAt), eq(articles.status, "published")))
    const row = rows[0]
    return row ? mapArticle(row) : null
  }

  async getNewLinks(): Promise<MiniLinkDto[]> {
    // 有详情链接按详情创建时间降序（id 降序 tiebreak）top 10 —— 与静态侧同一规则
    const dets = await this.db
      .select()
      .from(siteLinkDetails)
      .orderBy(desc(siteLinkDetails.sourceCreatedAt), desc(siteLinkDetails.linkId))
      .limit(10)
    if (dets.length === 0) return []
    const ids = dets.map((d) => d.linkId)
    const [links, cats] = await Promise.all([
      this.db.select().from(siteLinks).where(inArray(siteLinks.id, ids)),
      this.db.select().from(linkCategories),
    ])
    const linkById = new Map(links.map((l) => [l.id, l]))
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    return dets.map((d) => {
      const l = linkById.get(d.linkId)
      return {
        id: bigToStr(d.linkId) ?? "",
        title: l?.title ?? "",
        logoUrl: l?.logoPath ?? "",
        url: l?.url ?? "",
        categoryName: l ? (catName.get(l.categoryId) ?? "") : "",
      }
    })
  }

  async getRecentLinks(): Promise<MiniLinkDto[]> {
    // 源站 /api/public/recent-links 快照（site_settings.recent_links JSON；import 时按档案序 1:1 存档）
    const settings = await this.getSiteSettings()
    return settings.recentLinks
  }

  async getNewArticles(): Promise<MiniArticleDto[]> {
    const rows = await this.db
      .select()
      .from(articles)
      .where(and(isNull(articles.deletedAt), eq(articles.status, "published")))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(8)
    return rows.map(mapMiniArticle)
  }

  async getBulletins(): Promise<BulletinDto[]> {
    const rows = await this.db
      .select()
      .from(bulletins)
      .where(and(isNull(bulletins.deletedAt), eq(bulletins.status, "published")))
      .orderBy(asc(bulletins.sortOrder), asc(bulletins.id))
    return rows.map(mapBulletin)
  }

  async getAds(position: "home" = "home"): Promise<AdDto[]> {
    const rows = await this.db
      .select()
      .from(ads)
      .where(and(isNull(ads.deletedAt), eq(ads.status, "active"), eq(ads.position, position)))
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
    return mapSiteSettings(rows)
  }

  async getSitePage(pageKey: StaticField): Promise<SitePageDto | null> {
    const rows = await this.db.select().from(sitePages).where(eq(sitePages.pageKey, pageKey))
    const row = rows[0]
    return row ? mapSitePage(row) : null
  }
}
