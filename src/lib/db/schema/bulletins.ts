// 公告
import { sql } from "drizzle-orm"
import { bigint, datetime, index, int, longtext, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

export const bulletins = mysqlTable(
  "bulletins",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    contentHtml: longtext("content_html").notNull(),
    status: mysqlEnum("status", ["draft", "published", "archived"]).notNull().default("published"),
    sortOrder: int("sort_order").notNull().default(0),
    publishedAt: datetime("published_at", { mode: "string", fsp: 3 }),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [index("idx_bulletins_status_sort").on(t.status, t.deletedAt, t.sortOrder, t.publishedAt)],
)

export type Bulletin = typeof bulletins.$inferSelect
