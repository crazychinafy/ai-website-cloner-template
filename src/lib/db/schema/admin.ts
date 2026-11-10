// 管理员账号表（P2 建表；认证逻辑 P3）
// BIGINT 一律 { mode: "bigint" }（JS BigInt，20 位无损）；datetime 一律 mode "string" + fsp 3（墙钟字符串，无损往返）
import { sql } from "drizzle-orm"
import { bigint, boolean, datetime, index, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core"

export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    username: varchar("username", { length: 64 }).notNull().unique("uq_admin_users_username"),
    email: varchar("email", { length: 190 }).unique("uq_admin_users_email"),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    status: mysqlEnum("status", ["active", "disabled", "locked"]).notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    lastLoginAt: datetime("last_login_at", { mode: "string", fsp: 3 }),
    passwordChangedAt: datetime("password_changed_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [index("idx_admin_users_status").on(t.status, t.deletedAt)],
)

export type AdminUser = typeof adminUsers.$inferSelect
export type NewAdminUser = typeof adminUsers.$inferInsert
