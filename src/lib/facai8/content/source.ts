// P4：内容数据源选择（§10 双数据源配置）
// - CONTENT_SOURCE=static（默认）→ StaticSnapshotRepository（只读 src/lib/facai8/data/，无 DB 依赖）
// - CONTENT_SOURCE=mysql → MySqlRepository（P4 导入后的数据库）
// 约束：
//   - 本阶段只建立选择基础设施；src/app 前台页面不接入本模块（P8 才正式切换）
//   - 无隐式回退：mysql 被选择但数据库不可用 → 查询抛错，绝不静默改读静态数据
//   - server-only：连接凭据与数据库客户端绝不进浏览器
import "server-only"
import { getAdminEnv } from "@/lib/admin/validation/env"
import { getDrizzle } from "@/lib/db/client"
import { StaticSnapshotRepository } from "./static-repository"
import { MySqlRepository } from "./mysql-repository"
import type { ContentRepository } from "./repository"

export type { ContentRepository } from "./repository"
export type { ArticleQuery } from "./repository"
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
  SitePageDto,
  SiteSettingsDto,
  TagDto,
} from "./types"

let cached: ContentRepository | null = null

/** 获取当前数据源的内容仓库（进程内单例；CONTENT_SOURCE 决定实现，绝不回退） */
export function getContentRepository(): ContentRepository {
  if (cached) return cached
  const source = getAdminEnv().CONTENT_SOURCE
  if (source === "mysql") {
    cached = new MySqlRepository(getDrizzle())
  } else {
    cached = new StaticSnapshotRepository()
  }
  return cached
}

/** 仅供测试/工具显式注入（如测试注入 scratch 库实例）；重置单例缓存 */
export function setContentRepositoryForTest(repo: ContentRepository): void {
  cached = repo
}
