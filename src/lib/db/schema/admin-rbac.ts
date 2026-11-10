// RBAC：角色、权限字典、两个多对多关联表
import { sql } from "drizzle-orm"
import { bigint, boolean, datetime, index, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

export const adminRoles = mysqlTable("admin_roles", {
  id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique("uq_admin_roles_code"),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 255 }),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
})

export const adminPermissions = mysqlTable(
  "admin_permissions",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    code: varchar("code", { length: 100 }).notNull().unique("uq_admin_permissions_code"),
    name: varchar("name", { length: 120 }).notNull(),
    resource: varchar("resource", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
  },
  (t) => [index("idx_admin_permissions_resource").on(t.resource, t.action)],
)

export const adminUserRoles = mysqlTable(
  "admin_user_roles",
  {
    userId: bigint("user_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => adminRoles.id, { onDelete: "restrict" }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [primaryKey({ name: "pk_admin_user_roles", columns: [t.userId, t.roleId] })],
)

export const adminRolePermissions = mysqlTable(
  "admin_role_permissions",
  {
    roleId: bigint("role_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
    permissionId: bigint("permission_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => adminPermissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ name: "pk_admin_role_permissions", columns: [t.roleId, t.permissionId] })],
)

export type AdminRole = typeof adminRoles.$inferSelect
export type AdminPermission = typeof adminPermissions.$inferSelect
