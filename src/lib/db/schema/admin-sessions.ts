// 管理员服务端会话 + 登录失败记录（token 只存 SHA-256 摘要）
import { sql } from "drizzle-orm"
import { bigint, boolean, char, datetime, index, mysqlTable, varbinary, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

export const adminSessions = mysqlTable(
  "admin_sessions",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique("uq_admin_sessions_token_hash"),
    expiresAt: datetime("expires_at", { mode: "string", fsp: 3 }).notNull(),
    lastSeenAt: datetime("last_seen_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    revokedAt: datetime("revoked_at", { mode: "string", fsp: 3 }),
    userAgent: varchar("user_agent", { length: 500 }),
    ipAddress: varbinary("ip_address", { length: 16 }),
  },
  (t) => [index("idx_admin_sessions_user_expiry").on(t.userId, t.expiresAt, t.revokedAt)],
)

export const adminLoginAttempts = mysqlTable(
  "admin_login_attempts",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    usernameKey: char("username_key", { length: 64 }).notNull(),
    ipKey: char("ip_key", { length: 64 }).notNull(),
    attemptedAt: datetime("attempted_at", { mode: "string", fsp: 3 }).notNull().default(
      sql`CURRENT_TIMESTAMP(3)`,
    ),
    succeeded: boolean("succeeded").notNull().default(false),
  },
  (t) => [
    index("idx_admin_login_username_time").on(t.usernameKey, t.attemptedAt),
    index("idx_admin_login_ip_time").on(t.ipKey, t.attemptedAt),
  ],
)

export type AdminSession = typeof adminSessions.$inferSelect
