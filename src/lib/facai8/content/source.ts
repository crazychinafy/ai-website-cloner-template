// P4：内容数据源选择（§10 双数据源配置）
// - CONTENT_SOURCE=static（默认）→ StaticSnapshotRepository（只读 src/lib/facai8/data/，无 DB 依赖）
// - CONTENT_SOURCE=mysql → MySqlRepository（P4 导入后的数据库）
// 约束：
//   - P8 起前台页面经本模块取数（唯一入口 getContentRepository()；禁止 URL 参数临时切源）
//   - 无隐式回退：mysql 被选择但数据库不可用 → 查询抛错，绝不静默改读静态数据（P8-8 转 5xx）
//   - server-only：连接凭据与数据库客户端绝不进浏览器
import "server-only"
import { cache } from "react"
import { getAdminEnv } from "@/lib/admin/validation/env"
import { getDrizzle } from "@/lib/db/client"
import { ContentSourceError } from "./errors"
import { StaticSnapshotRepository } from "./static-repository"
import { MySqlRepository } from "./mysql-repository"
import type { ContentRepository } from "./repository"

export type { ContentRepository } from "./repository"
export type { ArticleQuery } from "./repository"
export { SEARCH_ARTICLE_LIMIT, SEARCH_LINK_LIMIT } from "./repository"
export type {
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
} from "./types"

let cached: ContentRepository | null = null

// ── P8-7 请求级去重 ─────────────────────────────────────────────
// 依据 Next 16 文档（node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md
// 「Reusing data with React.cache」+ 01-app/02-guides/caching-without-cache-components.md
// 「Deduplicating requests」）：本项目未开 cacheComponents，前台全部路由为动态渲染（ƒ），
// 每次请求全量 SSR —— 无构建期内容缓存（build 路由清单佐证）。
// 同一请求内 page + generateMetadata + layout(Header/SiteFooter) 会多次调用同一仓库方法
// （如 getSiteSettings 至少 3 次）；直接调 ORM 无 fetch 级自动去重，故按官方模式用 React.cache
// 包裹：作用域 = 当前请求、跨请求零共享、失败 Promise 同样共享（P8-8 一致性 5xx）。
// 静态源同理适用（微任务即决，去重语义一致，双模行为不变）。
const CONTENT_METHODS = [
  "getHomeCategories",
  "getLinksGroupedForHome",
  "getLinksByCategory",
  "getLinksByTag",
  "getLinkById",
  "getLinkDetail",
  "getLinkMirrors",
  "getArticleCategories",
  "getArticles",
  "getArticleById",
  "getRelatedLinksForArticle",
  "getRelatedArticlesForLink",
  "getNewLinks",
  "getRecentLinks",
  "getNewArticles",
  "searchLinks",
  "searchArticles",
  "getBulletins",
  "getBulletinById",
  "getAds",
  "getTags",
  "getTagById",
  "getLines",
  "getIconLibraries",
  "getSiteSettings",
  "getSitePage",
] as const satisfies readonly (keyof Omit<ContentRepository, "source">)[]

/**
 * P8-8 故障边界：任何仓库方法抛错 → 包成 ContentSourceError（固定消息含 32hex 请求编号）。
 * - 绝不吞错、绝不回退静态数据（mysql 被选择但库挂掉 = 500，不是静态内容）
 * - 服务端日志一行：source/method/requestId + 原始错误（凭据/SQL 只进日志，不进响应）
 * - 已是 ContentSourceError 的（同请求内 cache 共享失败 Promise）原样再抛
 * 纯包装（不依赖 React.cache），独立可测；生产链 = withRequestCache(错误边界(真实仓库))。
 */
export function withContentErrorBoundary(repo: ContentRepository): ContentRepository {
  const facade = { source: repo.source } as unknown as Record<string, unknown>
  for (const name of CONTENT_METHODS) {
    const fn = repo[name].bind(repo) as unknown as (...args: unknown[]) => Promise<unknown>
    facade[name] = async (...args: unknown[]): Promise<unknown> => {
      try {
        return await fn(...args)
      } catch (e) {
        if (e instanceof ContentSourceError) throw e
        const err = new ContentSourceError(repo.source, name, e)
        console.error(
          `[content-error] source=${repo.source} method=${name}() requestId=${err.requestId}`,
          e
        )
        throw err
      }
    }
  }
  return facade as unknown as ContentRepository
}

/** 用 React.cache 把仓库方法包成请求级去重门面（source 属性原样透传） */
function withRequestCache(bounded: ContentRepository): ContentRepository {
  const facade = { source: bounded.source } as unknown as Record<string, unknown>
  for (const name of CONTENT_METHODS) {
    const fn = bounded[name].bind(bounded) as unknown as (...args: unknown[]) => Promise<unknown>
    facade[name] = cache(fn)
  }
  return facade as unknown as ContentRepository
}

/** 获取当前数据源的内容仓库（进程内单例；CONTENT_SOURCE 决定实现，绝不回退） */
export function getContentRepository(): ContentRepository {
  if (cached) return cached
  const source = getAdminEnv().CONTENT_SOURCE
  if (source === "mysql") {
    cached = withRequestCache(withContentErrorBoundary(new MySqlRepository(getDrizzle())))
  } else {
    cached = withRequestCache(withContentErrorBoundary(new StaticSnapshotRepository()))
  }
  return cached
}

/** 仅供测试/工具显式注入（如测试注入 scratch 库实例）；重置单例缓存 */
export function setContentRepositoryForTest(repo: ContentRepository): void {
  cached = repo
}
