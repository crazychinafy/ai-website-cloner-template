// P4：StaticSnapshotRepository —— 只读 src/lib/facai8/data/ 静态快照（CONTENT_SOURCE=static，默认）
// 与 MySqlRepository 返回完全相同的 DTO（§9）；本实现不依赖数据库，Node 脚本 / vitest 可直接加载。
// 排序语义 = 前台页面的真实渲染序（与 import 写入 DB 的 sort_order 规则一致，§6）：
//   - 分类链接 = CAT_ORDER 序列优先、其余按档案序追加（applyLinkOrder）
//   - 标签链接 = TAG_ORDER 序列优先、其余按档案序追加
//   - 文章 = createdAt 降序、id 数值降序（前台文章列表页规则）
//   - 分类/标签/线路/广告/公告 = 源站数组序
import { LINK_CATEGORIES, type CatNode } from "../data/categories.ts"
import { ALL_LINKS } from "../data/links.ts"
import { CAT_ORDER, TAG_ORDER, applyLinkOrder } from "../data/link-order.ts"
import { LINK_DETAILS } from "../data/link-details.ts"
import { LINK_MIRRORS } from "../data/link-mirrors.ts"
import { TAGS } from "../data/tags.ts"
import { ALL_ARTICLES } from "../data/articles.ts"
import { ARTICLE_CATEGORIES } from "../data/article-categories.ts"
import { BULLETINS } from "../data/bulletins.ts"
import { HOME_ADS } from "../data/ads.ts"
import { ALL_LINES } from "../data/lines.ts"
import { SITE_INFO } from "../data/site-info.ts"
import { ICON_LIBRARIES } from "../data/icon-libraries.ts"
import { SITE_STATIC } from "../data/site-static.ts"
import { HOME_POPUP } from "../data/popup.ts"
import { STATS } from "../data/stats.ts"
import { RECENT_LINKS } from "../data/recent-links.ts"
import { SEARCH_DESCRIPTIONS } from "../data/searchDescriptions.ts"
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

/** 纯数字字符串比较（17/18 位 id 异长先比长度 → 数值序，避免字典序误判） */
function cmpId(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

/** 同构日期字符串比较（"YYYY-MM-DDTHH:MM:SS" 定长 → 字典序 = 时间序） */
function cmpDate(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

const linkById = new Map(ALL_LINKS.map((l) => [l.id, l]))

/** 分类 id → 名称（含子分类） */
const catName = new Map<string, string>()
for (const c of LINK_CATEGORIES) {
  catName.set(c.id, c.name)
  for (const s of c.children) catName.set(s.id, s.name)
}

function toLinkDto(l: (typeof ALL_LINKS)[number]): LinkItemDto {
  return {
    id: l.id,
    categoryId: l.categoryId,
    logoUrl: l.logoUrl,
    url: l.url,
    title: l.title,
    description: l.description,
    isGone: l.isGone,
    tagId: l.tagId,
  }
}

function toMiniLink(l: (typeof ALL_LINKS)[number]): MiniLinkDto {
  return {
    id: l.id,
    title: l.title,
    logoUrl: l.logoUrl,
    url: l.url,
    categoryName: catName.get(l.categoryId) ?? "",
  }
}

function toCatDto(c: CatNode): CatNodeDto {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    sortOrder: c.sortOrder,
    children: c.children.map((s) => ({ id: s.id, name: s.name, icon: s.icon, sortOrder: s.sortOrder, children: [] })),
  }
}

export class StaticSnapshotRepository implements ContentRepository {
  readonly source = "static" as const

  async getHomeCategories(): Promise<CatNodeDto[]> {
    return LINK_CATEGORIES.map(toCatDto)
  }

  async getLinksByCategory(categoryId: string): Promise<LinkItemDto[]> {
    const links = ALL_LINKS.filter((l) => l.categoryId === categoryId)
    return applyLinkOrder(links, CAT_ORDER[categoryId]).map(toLinkDto)
  }

  async getLinksByTag(tagId: string): Promise<LinkItemDto[]> {
    const links = ALL_LINKS.filter((l) => l.tagId === tagId)
    return applyLinkOrder(links, TAG_ORDER[tagId]).map(toLinkDto)
  }

  async getLinkById(id: string): Promise<LinkItemDto | null> {
    const l = linkById.get(id)
    return l ? toLinkDto(l) : null
  }

  async getLinkDetail(id: string): Promise<LinkDetailDto | null> {
    const d = LINK_DETAILS[id]
    if (!d) return null // 源站无档 → null，绝不伪造
    const l = linkById.get(id)
    return {
      id: d.id,
      clickCount: d.clickCount,
      likeCount: d.likeCount,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      annotation: d.annotation,
      previewImage: d.previewImage,
      // 前台渲染契约：logo 取 extra.logoUrl || link.logoUrl（P4 已验证 122 行两侧恒等 → MySQL 侧由链接行派生，无信息丢失）
      logoUrl: d.logoUrl || l?.logoUrl || "",
      // 前台仅在非空时渲染分类徽章；P4 已验证 122 行与链接当前分类名恒等 → MySQL 侧由分类 join 派生
      categoryName: d.categoryName,
      detail: d.detail,
    }
  }

  async getLinkMirrors(linkId: string): Promise<LinkMirrorDto[]> {
    return (LINK_MIRRORS[linkId] ?? []).map((m) => ({ id: m.id, name: m.name, url: m.url }))
  }

  async getArticleCategories(): Promise<ArticleCategoryDto[]> {
    return ARTICLE_CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder }))
  }

  async getArticles(query?: ArticleQuery): Promise<ArticleDto[]> {
    let rows = ALL_ARTICLES
    if (query?.categoryId) rows = rows.filter((a) => a.categoryId === query.categoryId)
    return [...rows].sort((a, b) => (a.createdAt === b.createdAt ? cmpId(b.id, a.id) : cmpDate(b.createdAt, a.createdAt))).map((a) => ({ ...a }))
  }

  async getArticleById(id: string): Promise<ArticleDto | null> {
    const a = ALL_ARTICLES.find((x) => x.id === id)
    return a ? { ...a } : null
  }

  async getNewLinks(): Promise<MiniLinkDto[]> {
    // 源站 /api/public/new-links 语义 = 有详情链接按详情 createdAt 降序（id 降序 tiebreak）top 10
    // （P4 审计已验证与 NEW_LINKS 存档 100% 一致 → 按规则重算，保证与 MySQL 侧同规则）
    return ALL_LINKS.filter((l) => LINK_DETAILS[l.id])
      .sort((a, b) => {
        const da = LINK_DETAILS[a.id].createdAt
        const db = LINK_DETAILS[b.id].createdAt
        return da === db ? cmpId(b.id, a.id) : cmpDate(db, da)
      })
      .slice(0, 10)
      .map(toMiniLink)
  }

  async getRecentLinks(): Promise<MiniLinkDto[]> {
    // 源站 /api/public/recent-links 快照（含无详情链接，不可复算）→ 原样
    return RECENT_LINKS.map((m) => ({ ...m }))
  }

  async getNewArticles(): Promise<MiniArticleDto[]> {
    // 源站 /api/public/new-articles 语义 = 文章 createdAt 降序（id 降序 tiebreak）top 8（已验证一致）
    return ALL_ARTICLES.slice()
      .sort((a, b) => (a.createdAt === b.createdAt ? cmpId(b.id, a.id) : cmpDate(b.createdAt, a.createdAt)))
      .slice(0, 8)
      .map((a) => ({ id: a.id, title: a.title, categoryName: a.categoryName }))
  }

  async getBulletins(): Promise<BulletinDto[]> {
    return BULLETINS.map((b) => ({ id: b.id, title: b.title, createdAt: b.createdAt, content: b.content }))
  }

  async getAds(): Promise<AdDto[]> {
    return HOME_ADS.map((a) => ({ id: a.id, linkUrl: a.linkUrl, imageUrl: a.imageUrl, title: a.title }))
  }

  async getTags(): Promise<TagDto[]> {
    return TAGS.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, bgColor: t.bgColor }))
  }

  async getLines(): Promise<LineDto[]> {
    return ALL_LINES.map((l) => ({ id: l.id, name: l.name, url: l.url }))
  }

  async getIconLibraries(): Promise<IconLibraryDto[]> {
    // 无前台消费者（iconfont css 直接引 public/）；仓库序规范为 id 数值升序
    return ICON_LIBRARIES.slice()
      .sort((a, b) => cmpId(a.id, b.id))
      .map((i) => ({ id: i.id, prefix: i.prefix, hash: i.hash, cssPath: i.cssPath }))
  }

  async getSiteSettings(): Promise<SiteSettingsDto> {
    return {
      siteName: SITE_INFO.siteName,
      siteDescription: SITE_INFO.siteDescription,
      siteLogo: SITE_INFO.siteLogo,
      siteFavicon: SITE_INFO.siteFavicon,
      footerText: SITE_INFO.footerText,
      adsRandom: SITE_INFO.adsRandom,
      popup: { enabled: HOME_POPUP.enabled, title: HOME_POPUP.title, content: HOME_POPUP.content },
      stats: { ...STATS },
      searchDescriptions: { ...SEARCH_DESCRIPTIONS },
      recentLinks: RECENT_LINKS.map((m) => ({ ...m })),
    }
  }

  async getSitePage(pageKey: StaticField): Promise<SitePageDto | null> {
    const p = SITE_STATIC[pageKey]
    if (!p) return null
    return { pageKey, title: p.title, subtitle: p.subtitle, html: p.html }
  }
}

export { cmpId as compareId, cmpDate as compareDate }
