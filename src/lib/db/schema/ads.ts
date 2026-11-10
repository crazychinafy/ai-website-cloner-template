// 广告（位置/素材/目标 URL/投放窗口/排序）
import { sql } from "drizzle-orm"
import { bigint, datetime, index, int, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

export const ads = mysqlTable(
  "ads",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
    position: varchar("position", { length: 64 }).notNull().default("home"),
    title: varchar("title", { length: 255 }).notNull(),
    targetUrl: varchar("target_url", { length: 2048 }).notNull(),
    imagePath: varchar("image_path", { length: 1024 }).notNull(),
    status: mysqlEnum("status", ["draft", "active", "disabled", "expired"]).notNull().default("active"),
    sortOrder: int("sort_order").notNull().default(0),
    startsAt: datetime("starts_at", { mode: "string", fsp: 3 }),
    endsAt: datetime("ends_at", { mode: "string", fsp: 3 }),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [
    index("idx_ads_position_status_sort").on(t.position, t.status, t.deletedAt, t.sortOrder),
    index("idx_ads_schedule").on(t.startsAt, t.endsAt),
  ],
)

export type Ad = typeof ads.$inferSelect
