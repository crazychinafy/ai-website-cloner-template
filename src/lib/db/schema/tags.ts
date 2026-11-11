// 网址标签
import { sql } from "drizzle-orm"
import { bigint, datetime, index, int, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

// DDL 修正：源文档 site_tags.created_at 误带 ON UPDATE CURRENT_TIMESTAMP(3)，已同步修正 SQL 文档 —— created_at 只取初值
export const siteTags = mysqlTable(
  "site_tags",
  {
    // P6A：见 link_categories 注释；本表无 updated_at（以实际 migration 为准）
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    iconClass: varchar("icon_class", { length: 255 }).notNull().default(""),
    color: varchar("color", { length: 32 }).notNull().default("#000000"),
    bgColor: varchar("bg_color", { length: 32 }).notNull().default("#ffffff"),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    sortOrder: int("sort_order").notNull().default(0),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [index("idx_site_tags_status_sort").on(t.status, t.sortOrder)],
)

export type SiteTag = typeof siteTags.$inferSelect
