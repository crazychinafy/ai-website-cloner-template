// 网址分类（两级，parent_id 自引用）+ 文章分类
// P6A.1：三张内容表增加“活动名称”生成列 + UNIQUE 索引（MySQL 8）：
//   未删除行 active_name = name；软删除行 = NULL（NULL 不参与唯一约束 → 软删除历史行可同名共存）。
//   网址分类另加 parent_scope_id（根分类哨兵 0，合法 ID 从 1 起，永不冲突），
//   使“同一父级下未删除唯一名称”由数据库层强制（并发创建/恢复竞态的最终防线）。
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core"

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
    // P6A.1 生成列（STORED）：唯一名称作用域 + 活动名称（软删除 → NULL 自动退出约束）
    parentScopeId: bigint("parent_scope_id", { mode: "bigint", unsigned: true })
      .generatedAlwaysAs(sql`(case when \`parent_id\` is null then 0 else \`parent_id\` end)`, { mode: "stored" }),
    activeName: varchar("active_name", { length: 120 })
      .generatedAlwaysAs(sql`(case when \`deleted_at\` is null then \`name\` else null end)`, { mode: "stored" }),
  },
  (t) => [
    index("idx_link_categories_parent_sort").on(t.parentId, t.status, t.sortOrder),
    uniqueIndex("uq_link_categories_active_name").on(t.parentScopeId, t.activeName),
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
    // P6A.1 生成列（STORED）：软删除 → NULL（不参与唯一约束），历史同名行可共存
    activeName: varchar("active_name", { length: 120 })
      .generatedAlwaysAs(sql`(case when \`deleted_at\` is null then \`name\` else null end)`, { mode: "stored" }),
  },
  (t) => [
    index("idx_article_categories_status_sort").on(t.status, t.sortOrder),
    uniqueIndex("uq_article_categories_active_name").on(t.activeName),
  ],
)

export type LinkCategory = typeof linkCategories.$inferSelect
export type ArticleCategory = typeof articleCategories.$inferSelect
