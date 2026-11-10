// 管理操作审计日志（before/after JSON；敏感字段由应用层脱敏后才写入）
import { sql } from "drizzle-orm"
import { bigint, datetime, index, json, mysqlTable, varbinary, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

export const adminAuditLogs = mysqlTable(
  "admin_audit_logs",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    actorUserId: bigint("actor_user_id", { mode: "bigint", unsigned: true }).references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 100 }),
    beforeJson: json("before_json"),
    afterJson: json("after_json"),
    requestId: varchar("request_id", { length: 64 }),
    ipAddress: varbinary("ip_address", { length: 16 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index("idx_admin_audit_actor_time").on(t.actorUserId, t.createdAt),
    index("idx_admin_audit_resource").on(t.resourceType, t.resourceId, t.createdAt),
  ],
)

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect
