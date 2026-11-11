// 网址分类（两级，parent_id 自引用）+ 文章分类
import { sql } from "drizzle-orm"
import { bigint, boolean, datetime, foreignKey, index, int, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

export const linkCategories = mysqlTable(
  "link_categories",
  {
    // P6A：BIGINT 主键启用 AUTO_INCREMENT（migration 0001）；静态快照仍显式写入原始 17/18 位 ID
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().autoincrement().primaryKey(),
    // 自引用外键放在表级约束（drizzle 列级 .references() 自引用在 strict 下类型循环，见 P2 报告）
    parentId: bigint("parent_id", { mode: "bigint", unsigned: true }),
    name: varchar("name", { length: 120 }).notNull(),
    iconClass: varchar("icon_class", { length: 255 }).notNull().default(""),
    sortOrder: int("sort_order").notNull().default(0),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    sourceSnapshot: boolean("source_snapshot").notNull().default(true),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [
    index("idx_link_categories_parent_sort").on(t.parentId, t.status, t.sortOrder),
    foreignKey({ name: "fk_link_categories_parent", columns: [t.parentId], foreignColumns: [t.id] }).onDelete(
      "restrict",
    ),
  ],
)

export const articleCategories = mysqlTable(
  "article_categories",
  {
    // P6A：见 linkCategories 注释
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    iconClass: varchar("icon_class", { length: 255 }).notNull().default(""),
    sortOrder: int("sort_order").notNull().default(0),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [index("idx_article_categories_status_sort").on(t.status, t.sortOrder)],
)

export type LinkCategory = typeof linkCategories.$inferSelect
export type ArticleCategory = typeof articleCategories.$inferSelect
