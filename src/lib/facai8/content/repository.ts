// P4：Content Repository 统一接口（§3 架构 / §9 接口一致性）
// 页面（P8 起）只依赖本接口，不直接 import 数据文件，更不直接 import 数据库客户端。
// 两套实现：
//   - StaticSnapshotRepository：只读 src/lib/facai8/data/ 静态快照（CONTENT_SOURCE=static 默认）
//   - MySqlRepository：读 P2 schema 各表（CONTENT_SOURCE=mysql）
// 排序语义（两实现一致，即源站分类页/标签页/列表页的真实渲染序）：
//   - getLinksByCategory = CAT_ORDER 序列优先、其余按档案序追加（= import 写入的 site_links.sort_order 序）
//   - getLinksByTag = TAG_ORDER 序列优先、其余按档案序追加（静态侧）；
//     MySQL 侧无独立标签排序列（P2 schema 单 sort_order 约束）→ 按 (sort_order, id)，
//     集合与字段一致，标签页网格序为 P8 已知显示差异（见 P4 报告 §10）
//   - getArticles = createdAt 降序、id 降序（前台文章列表页规则）
//   - 分类/标签/线路/广告/公告等 = 源站数组序（MySQL 侧由对应 sort_order 列 + id 稳定 tiebreak 复现）

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

export interface ArticleQuery {
  /** 分类精确匹配（缺省 = 全部分类） */
  categoryId?: string
}

export interface ContentRepository {
  /** 当前数据源标识（static | mysql） */
  readonly source: "static" | "mysql"

  // ── 网址与分类 ──
  /** 首页两级分类树（顶层序 = 源站数组序 = sort_order 序） */
  getHomeCategories(): Promise<CatNodeDto[]>
  /** 分类链接列表（§6 规范序：CAT_ORDER + 档案追加；含 isGone 链接） */
  getLinksByCategory(categoryId: string): Promise<LinkItemDto[]>
  /** 标签链接列表（静态侧 = TAG_ORDER + 档案追加；MySQL 侧 = sort_order 序，集合一致） */
  getLinksByTag(tagId: string): Promise<LinkItemDto[]>
  /** 链接主记录；不存在 → null */
  getLinkById(id: string): Promise<LinkItemDto | null>
  /** 链接详情；源站无档（未收录详情）→ null，绝不伪造 */
  getLinkDetail(id: string): Promise<LinkDetailDto | null>
  /** 备用链接（无档 → 空数组，与前台 mirrorsForLink 语义一致） */
  getLinkMirrors(linkId: string): Promise<LinkMirrorDto[]>

  // ── 文章 ──
  getArticleCategories(): Promise<ArticleCategoryDto[]>
  /** 文章列表（createdAt 降序、id 降序） */
  getArticles(query?: ArticleQuery): Promise<ArticleDto[]>
  getArticleById(id: string): Promise<ArticleDto | null>
  /** 首页右栏「最新收录」（= 有详情链接按详情 createdAt 降序 top 10，两实现均按此规则重算） */
  getNewLinks(): Promise<MiniLinkDto[]>
  /** 首页右栏「最近更新」（源站快照；静态侧读 RECENT_LINKS，MySQL 侧读 site_settings.recent_links JSON） */
  getRecentLinks(): Promise<MiniLinkDto[]>
  /** 首页右栏「最新文章」（= 文章 createdAt 降序 top 8） */
  getNewArticles(): Promise<MiniArticleDto[]>

  // ── 站点运营 ──
  getBulletins(): Promise<BulletinDto[]>
  /** 广告（position 缺省 = "home"，源站唯一位置） */
  getAds(position?: "home"): Promise<AdDto[]>
  getTags(): Promise<TagDto[]>
  getLines(): Promise<LineDto[]>
  /** 图标库（id 升序规范序；静态资源本体仍在 public/，此处只返回元数据） */
  getIconLibraries(): Promise<IconLibraryDto[]>
  /** 站点设置聚合（site_name 等 6 键 + home_popup + stats + search_descriptions + recent_links） */
  getSiteSettings(): Promise<SiteSettingsDto>
  /** 固定静态页（aboutUs/disclaimer/agreement/privacy）；不存在 → null */
  getSitePage(pageKey: StaticField): Promise<SitePageDto | null>
}
