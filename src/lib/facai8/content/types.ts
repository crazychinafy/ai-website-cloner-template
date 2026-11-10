// P4：内容层统一 DTO —— 以现有前台页面/组件的真实消费结构为准（§9）
// 两套 Repository（StaticSnapshot / MySql）必须返回完全相同的结构：
//   - ID 一律 string（BIGINT 精度保护 §5；17/18 位源站 ID 全程不转 Number）
//   - 日期一律 "YYYY-MM-DDTHH:MM:SS"（UTC 墙钟，秒精度，§11 规范化规则）
//   - null 与 "" 严格区分（tagId=null 表示源站无标签；logoUrl="" 表示源站无 Logo）
//   - 计数（clickCount/likeCount/viewCount）一律 string（与前台 fmtK/parseInt 消费一致）
import type { StaticField } from "../data/site-static.ts"

/** 分类（前台 CatNode 原形；sortOrder 保持 string —— 前台以字符串消费，不擅自改语义） */
export interface CatNodeDto {
  id: string
  name: string
  icon: string
  sortOrder: string
  children: CatNodeDto[]
}

/** 链接（前台 LinkItem 原形） */
export interface LinkItemDto {
  id: string
  categoryId: string
  logoUrl: string
  url: string
  title: string
  description: string
  isGone: 0 | 1
  tagId: string | null
}

/** 链接详情补充字段（前台 LinkDetailExtra 原形；只覆盖源站有档的 122 条，缺失返回 null 不伪造） */
export interface LinkDetailDto {
  id: string
  clickCount: string
  likeCount: string
  createdAt: string
  updatedAt: string
  annotation: string
  previewImage: string
  logoUrl: string
  categoryName: string
  detail: string
}

/** 备用链接（前台 LinkMirror 原形；顺序 = 源站数组序） */
export interface LinkMirrorDto {
  id: string
  name: string
  url: string
}

/** 标签（前台 Tag 原形） */
export interface TagDto {
  id: string
  name: string
  icon: string
  color: string
  bgColor: string
}

/** 文章分类（前台 ArticleCategory 原形；sortOrder 保持 string） */
export interface ArticleCategoryDto {
  id: string
  name: string
  icon: string
  sortOrder: string
}

/** 文章（前台 Article 原形；content 为 HTML 原文，展示映射由 asset()/localHtml() 在消费侧完成） */
export interface ArticleDto {
  id: string
  title: string
  content: string
  coverImage: string
  categoryId: string
  categoryName: string
  seoTitle: string
  seoKeywords: string
  seoDescription: string
  viewCount: string
  createdAt: string
  updatedAt: string
  authorName: string
  authorAvatar: string
}

/** 公告（前台 Bulletin 原形） */
export interface BulletinDto {
  id: string
  title: string
  createdAt: string
  content: string
}

/** 广告（前台 Ad 原形；linkUrl = 目标 URL） */
export interface AdDto {
  id: string
  linkUrl: string
  imageUrl: string
  title: string
}

/** 线路（前台 LineItem 原形） */
export interface LineDto {
  id: string
  name: string
  url: string
}

/** 图标库（前台 IconLibrary 原形；仓库序 = id 升序 —— 无前台消费者，源数组序为存档附带序） */
export interface IconLibraryDto {
  id: string
  prefix: string
  hash: string
  cssPath: string
}

/** 站点静态页（前台 SITE_STATIC 原形；pageKey = aboutUs | disclaimer | privacy | agreement） */
export interface SitePageDto {
  pageKey: StaticField
  title: string
  subtitle: string
  html: string
}

/** 首页「最近更新」右栏（前台 MiniLink 原形；源站 /api/public/recent-links 快照，不可由主数据复算） */
export interface MiniLinkDto {
  id: string
  title: string
  logoUrl: string
  url: string
  categoryName: string
}

/** 首页「最新文章」右栏（前台 MiniArticle 原形） */
export interface MiniArticleDto {
  id: string
  title: string
  categoryName: string
}

/** 站点设置聚合（前台 SITE_INFO + HOME_POPUP + STATS + SEARCH_DESCRIPTIONS + RECENT_LINKS 消费形态） */
export interface SiteSettingsDto {
  siteName: string
  siteDescription: string
  siteLogo: string
  siteFavicon: string
  footerText: string
  adsRandom: boolean
  popup: {
    enabled: boolean
    title: string
    content: string
  }
  stats: {
    links: string
    articles: string
    comments: string
    totalViews: string
  }
  /** 源站搜索接口 description 快照（articleId → description；11 条不可单规则复现，1:1 存档） */
  searchDescriptions: Record<string, string>
  /** 最近 10 条「最近更新」（不可复算的源站快照） */
  recentLinks: MiniLinkDto[]
}

/** 站点设置键（site_settings.setting_key 合法值） */
export const SITE_SETTING_KEYS = [
  "site_name",
  "site_description",
  "site_logo",
  "site_favicon",
  "footer_text",
  "ads_random",
  "home_popup",
  "stats",
  "search_descriptions",
  "recent_links",
] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]
