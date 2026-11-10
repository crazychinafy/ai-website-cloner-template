// 站点设置（JSON 值）+ 站点页面 + 图标库
import { sql } from "drizzle-orm"
import { bigint, datetime, int, json, longtext, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

// 站点设置：setting_key 即业务主键（如 site_name / footer_text）
export const siteSettings = mysqlTable("site_settings", {
  settingKey: varchar("setting_key", { length: 100 }).notNull().primaryKey(),
  settingValue: json("setting_value").notNull(),
  updatedBy: bigint("updated_by", { mode: "bigint", unsigned: true }).references(() => adminUsers.id, {
    onDelete: "set null",
  }),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
})

// 站点页面：about / agreement / disclaimer / privacy 等固定 key 页面
export const sitePages = mysqlTable(
  "site_pages",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    pageKey: varchar("page_key", { length: 64 }).notNull().unique("uq_site_pages_key"),
    title: varchar("title", { length: 255 }).notNull(),
    subtitle: varchar("subtitle", { length: 500 }).notNull().default(""),
    contentHtml: longtext("content_html").notNull(),
    version: int("version", { unsigned: true }).notNull().default(1),
    updatedBy: bigint("updated_by", { mode: "bigint", unsigned: true }).references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
)

// 图标库：前端 icon css 资源的元数据（静态资源本体仍在 public/）
export const iconLibraries = mysqlTable(
  "icon_libraries",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
    prefix: varchar("prefix", { length: 64 }).notNull().default("icon-"),
    hash: varchar("hash", { length: 64 }).notNull().unique("uq_icon_libraries_hash"),
    cssPath: varchar("css_path", { length: 1024 }).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
)

export type SiteSetting = typeof siteSettings.$inferSelect
export type SitePage = typeof sitePages.$inferSelect
export type IconLibrary = typeof iconLibraries.$inferSelect
