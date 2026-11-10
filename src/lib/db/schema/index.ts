// 彩搜搜管理后台 Drizzle Schema 统一出口
// - 23 张表按业务模块拆分于本目录（对应 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql）
// - drizzle.config.ts 的 schema 入口指向本文件；kit 只读取导出的表
// - 前台/后台任何代码通过本文件引用表，不直接引用子模块以外的表定义
import * as admin from "./admin.ts"
import * as adminRbac from "./admin-rbac.ts"
import * as adminSessions from "./admin-sessions.ts"
import * as categories from "./categories.ts"
import * as links from "./links.ts"
import * as articles from "./articles.ts"
import * as bulletins from "./bulletins.ts"
import * as ads from "./ads.ts"
import * as tags from "./tags.ts"
import * as lines from "./lines.ts"
import * as settings from "./settings.ts"
import * as media from "./media.ts"
import * as audit from "./audit.ts"
import * as imports from "./imports.ts"

export * from "./admin.ts"
export * from "./admin-rbac.ts"
export * from "./admin-sessions.ts"
export * from "./categories.ts"
export * from "./links.ts"
export * from "./articles.ts"
export * from "./bulletins.ts"
export * from "./ads.ts"
export * from "./tags.ts"
export * from "./lines.ts"
export * from "./settings.ts"
export * from "./media.ts"
export * from "./audit.ts"
export * from "./imports.ts"

/**
 * 供 `drizzle(pool, { schema })` / drizzle-kit 使用的表集合。
 * 23 张表：admin_users, admin_roles, admin_permissions, admin_user_roles,
 * admin_role_permissions, admin_sessions, admin_login_attempts,
 * link_categories, article_categories, site_tags, site_links, site_link_details,
 * site_link_mirrors, articles, bulletins, ads, site_lines, site_settings,
 * site_pages, icon_libraries, media_assets, admin_audit_logs, admin_import_runs
 */
export const schema = {
  // 管理员与权限（7）
  adminUsers: admin.adminUsers,
  adminRoles: adminRbac.adminRoles,
  adminPermissions: adminRbac.adminPermissions,
  adminUserRoles: adminRbac.adminUserRoles,
  adminRolePermissions: adminRbac.adminRolePermissions,
  adminSessions: adminSessions.adminSessions,
  adminLoginAttempts: adminSessions.adminLoginAttempts,
  // 网址与分类（5）
  linkCategories: categories.linkCategories,
  articleCategories: categories.articleCategories,
  siteTags: tags.siteTags,
  siteLinks: links.siteLinks,
  siteLinkDetails: links.siteLinkDetails,
  siteLinkMirrors: links.siteLinkMirrors,
  // 文章与公告（3）
  articles: articles.articles,
  bulletins: bulletins.bulletins,
  ads: ads.ads,
  // 线路（1）
  siteLines: lines.siteLines,
  // 站点设置（3）
  siteSettings: settings.siteSettings,
  sitePages: settings.sitePages,
  iconLibraries: settings.iconLibraries,
  // 媒体（1）
  mediaAssets: media.mediaAssets,
  // 审计（1）
  adminAuditLogs: audit.adminAuditLogs,
  // 导入（1）
  adminImportRuns: imports.adminImportRuns,
}
