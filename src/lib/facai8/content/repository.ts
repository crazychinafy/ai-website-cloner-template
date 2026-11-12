// P4：Content Repository 统一接口（§3 架构 / §9 接口一致性）
// 页面（P8 起）只依赖本接口，不直接 import 数据文件，更不直接 import 数据库客户端。
// 两套实现：
//   - StaticSnapshotRepository：只读 src/lib/facai8/data/ 静态快照（CONTENT_SOURCE=static 默认）
//   - MySqlRepository：读 P2 schema 各表（CONTENT_SOURCE=mysql）
// 排序语义（两实现一致，即源站分类页/标签页/列表页的真实渲染序）：
//   - getLinksByCategory = CAT_ORDER 序列优先、其余按档案序追加（= import 写入的 site_links.sort_order 序）
//   - getLinksByTag = TAG_ORDER 序列优先、其余按档案序追加（静态侧）；
//     MySQL 侧由 migration 0006 新增 site_links.tag_sort_order（标签组内稠密排名，import/回填写入同一序列）复现，
//     两侧序列完全一致；后台新建/改标签的行按「组内 max+1 追加、NULL 按 id 附后」稳定规则（P8-0，不再是已知限制）
//   - getArticles = createdAt 降序、id 降序（前台文章列表页规则）
//   - 分类/标签/线路/广告/公告等 = 源站数组序（MySQL 侧由对应 sort_order 列 + id 稳定 tiebreak 复现）
// 公开可见性统一契约（P8-1，所有 get*/search* 读取方法都必须遵守）：
//   - links：status='published' 且 deleted_at IS NULL（isGone 链接仍可见——前台要渲染「已失效」徽章）
//   - articles / bulletins：上述两条 + published_at IS NOT NULL 且 published_at <= 数据库当前 UTC 时间
//     （草稿 / 计划发布 / 软删除行绝不泄漏到前台；时间判断用 DB 时钟 UTC_TIMESTAMP(3)，应用与 DB 无时区偏差）
//   - ads：status='active' 且 deleted_at IS NULL 且 (starts_at IS NULL OR starts_at <= now)
//     且 (ends_at IS NULL OR ends_at >= now)
//   - mirrors：无独立状态列，可见性继承所属链接（行只在链接可见时返回；getLinkDetail / getLinkMirrors
//     在 MySQL 侧各自先验所属链接公开状态——P8 契约补全，不依赖调用方先查 getLinkById）
//   - recent_links 设置快照：行内容按快照 ID 重读链接当前值并套用 links 谓词（P1 修复）——
//     停用 / 软删 / 改名改链立即反映到「最近更新」，getSiteSettings 与 getRecentLinks 共用同一过滤
//   - 静态档案 = 发布态快照（2026-11-08 前全部已发布），天然满足上述谓词 → 静态实现无需再过滤
//   - 关联/搜索方法内部只对「可见集合」应用规则（rules.ts 同一份纯函数），绝不扫描草稿行
// 无回退原则：mysql 数据源查询失败一律抛错（P8-8 转 5xx），绝不静默改读静态档案。

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

export interface ArticleQuery {
  /** 分类精确匹配（缺省 = 全部分类） */
  categoryId?: string
}

/**
 * 服务端搜索返回上限（P8-1 契约级常量，两侧 Repository 共用同一值）：
 * 静态档案只有 3791 链接 / 28 文章，天然不触发；MySQL 侧随运营数据增长防止无界结果集进 SSR。
 * 超出时 items = 列表规范序的前 LIMIT 条、total = 命中总数、truncated = true。
 */
export const SEARCH_LINK_LIMIT = 200
export const SEARCH_ARTICLE_LIMIT = 100

export interface ContentRepository {
  /** 当前数据源标识（static | mysql） */
  readonly source: "static" | "mysql"

  // ── 网址与分类 ──
  /** 首页两级分类树（顶层序 = 源站数组序 = sort_order 序） */
  getHomeCategories(): Promise<CatNodeDto[]>
  /**
   * 首页全量链接按分类分组（P8-1）：组内 = **档案原始序**（静态 = ALL_LINKS 数组序；
   * MySQL = (sort_order,id) —— P4 已验证档案序恒等），不按 CAT_ORDER 重排、不切片；
   * 键 = categoryId（首页 HomeShell 直接消费 Record<categoryId, LinkItemDto[]>）。
   */
  getLinksGroupedForHome(): Promise<Record<string, LinkItemDto[]>>
  /** 分类链接列表（§6 规范序：CAT_ORDER + 档案追加；含 isGone 链接） */
  getLinksByCategory(categoryId: string): Promise<LinkItemDto[]>
  /** 标签链接列表（静态侧 = TAG_ORDER + 档案追加；MySQL 侧 = sort_order 序，集合一致） */
  getLinksByTag(tagId: string): Promise<LinkItemDto[]>
  /** 链接主记录；不存在 → null */
  getLinkById(id: string): Promise<LinkItemDto | null>
  /** 链接详情；源站无档（未收录详情）→ null，绝不伪造；所属链接不可见（draft/停用/软删）→ null（可见性继承） */
  getLinkDetail(id: string): Promise<LinkDetailDto | null>
  /** 备用链接（无档 → 空数组，与前台 mirrorsForLink 语义一致）；所属链接不可见 → 空数组（可见性继承） */
  getLinkMirrors(linkId: string): Promise<LinkMirrorDto[]>

  // ── 文章 ──
  getArticleCategories(): Promise<ArticleCategoryDto[]>
  /** 文章列表（createdAt 降序、id 降序） */
  getArticles(query?: ArticleQuery): Promise<ArticleDto[]>
  getArticleById(id: string): Promise<ArticleDto | null>
  /**
   * 文章详情「相关网址」（P8-1；规则 = rules.pickRelatedLinks，与旧 util.relatedLinksForArticle 逐位一致）：
   * 可见且未失效链接中标题与文章标题互为子串（忽略大小写）→ 同名去重保留点击数最大者 → 点击数降序取 1 条。
   * 文章不存在 / 不可见 → 空数组（前台按「无匹配则不渲染侧栏」处理）。
   */
  getRelatedLinksForArticle(articleId: string): Promise<LinkItemDto[]>
  /**
   * 站点详情「相关文章」（P8-1；规则 = rules.pickRelatedArticles，与旧 util.relatedArticlesForLink 逐位一致）：
   * 可见文章中标题与链接标题互为子串（忽略大小写）→ 同名去重保留首现 → createdAt 降序取 10 条。
   * 链接不存在 / 不可见 → 空数组。
   */
  getRelatedArticlesForLink(linkId: string): Promise<ArticleDto[]>
  /** 首页右栏「最新收录」（= 有详情链接按详情 createdAt 降序 top 10，两实现均按此规则重算） */
  getNewLinks(): Promise<MiniLinkDto[]>
  /**
   * 首页右栏「最近更新」（源站快照；静态侧读 RECENT_LINKS，MySQL 侧读 site_settings.recent_links JSON）。
   * MySQL 侧按快照 ID 重读链接当前值并套用公开可见性（P1 修复），保留快照原序；与 getSiteSettings().recentLinks 恒等。
   */
  getRecentLinks(): Promise<MiniLinkDto[]>
  /** 首页右栏「最新文章」（= 文章 createdAt 降序 top 8） */
  getNewArticles(): Promise<MiniArticleDto[]>

  // ── 搜索（P8-1，服务端执行；空/全空白 query → 空结果；规则 = rules.searchHit，两侧同一份代码）──
  /**
   * 链接搜索：title/description 子串匹配（忽略大小写，不含 URL——源站实测语义），
   * 命中按列表规范序（静态 = 档案序；MySQL = (sort_order,id)，恒等）截断至 SEARCH_LINK_LIMIT。
   */
  searchLinks(query: string): Promise<SearchResults<SearchLinkDto>>
  /**
   * 文章搜索：title/content 子串匹配（忽略大小写，不含 categoryName——源站实测语义），
   * description 源站搜索快照优先、缺失回退 rules.articleExcerpt；
   * 命中按 createdAt 降序、id 降序截断至 SEARCH_ARTICLE_LIMIT。
   */
  searchArticles(query: string): Promise<SearchResults<SearchArticleDto>>

  // ── 站点运营 ──
  getBulletins(): Promise<BulletinDto[]>
  /** 公告主记录；不存在 / 不可见 → null（前台公告页渲染页内空态，非 404 —— 调用方语义保持不变） */
  getBulletinById(id: string): Promise<BulletinDto | null>
  /** 广告（position 缺省 = "home"，源站唯一位置） */
  getAds(position?: "home"): Promise<AdDto[]>
  getTags(): Promise<TagDto[]>
  /** 标签主记录；不存在 → null（标签页空态语义保持：标题「标签不存在」+ 空网格，非 404） */
  getTagById(tagId: string): Promise<TagDto | null>
  getLines(): Promise<LineDto[]>
  /** 图标库（id 升序规范序；静态资源本体仍在 public/，此处只返回元数据） */
  getIconLibraries(): Promise<IconLibraryDto[]>
  /** 站点设置聚合（site_name 等 6 键 + home_popup + stats + search_descriptions + recent_links） */
  getSiteSettings(): Promise<SiteSettingsDto>
  /** 固定静态页（aboutUs/disclaimer/agreement/privacy）；不存在 → null */
  getSitePage(pageKey: StaticField): Promise<SitePageDto | null>
}
