// 线路
import { sql } from "drizzle-orm"
import { bigint, datetime, index, int, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

export const siteLines = mysqlTable(
  "site_lines",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    sortOrder: int("sort_order").notNull().default(0),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [index("idx_site_lines_status_sort").on(t.status, t.deletedAt, t.sortOrder)],
)

export type SiteLine = typeof siteLines.$inferSelect
