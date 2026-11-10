// P2 Seed 测试：首次成功 / 重复执行幂等 / 角色权限映射 / 系统角色 vs 自定义角色隔离 / 不破坏管理员数据
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, makeDb } from "./test-db"
import { runSeedRbac } from "../../scripts/admin/seed-rbac.ts"
import * as schema from "../../src/lib/db/schema"
import { eq } from "drizzle-orm"

let pool: Pool

type Any = { query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> }
async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [rows] = await (pool as Any).query(sql, params)
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0)
}

beforeAll(async () => {
  pool = await freshMigratedPool()
}, 90_000)

afterAll(async () => {
  await dropScratch()
  await pool.end()
})

describe("seed 角色权限", () => {
  it("首次 seed：42 权限 / 4 角色 / 108 映射，数量与文档一致", async () => {
    const db = makeDb(pool)
    const report = await runSeedRbac(db)
    expect(report.permissions).toBe(42)
    expect(report.roles).toBe(4)
    expect(report.rolePermissions).toEqual({
      super_admin: 42,
      content_admin: 32,
      content_editor: 22,
      auditor: 12,
    })
    expect(await count("SELECT COUNT(*) AS n FROM admin_role_permissions")).toBe(108)
  })

  it("权限 code 唯一且覆盖 12 个资源", async () => {
    expect(await count("SELECT COUNT(*) AS n FROM admin_permissions")).toBe(42)
    expect(await count("SELECT COUNT(DISTINCT code) AS n FROM admin_permissions")).toBe(42)
    const [rows] = await (pool as Any).query(
      "SELECT resource, COUNT(*) AS n FROM admin_permissions GROUP BY resource ORDER BY resource",
    )
    const res = (rows as Array<{ resource: string; n: string }>).map((r) => r.resource)
    expect(res).toEqual(
      [
        "ads",
        "articles",
        "audit_logs",
        "categories",
        "dashboard",
        "imports",
        "links",
        "lines",
        "settings",
        "bulletins",
        "tags",
        "administrators",
      ].sort(),
    )
  })

  it("第二次 seed 不产生重复、不改映射（幂等）", async () => {
    const db = makeDb(pool)
    const report = await runSeedRbac(db)
    expect(report.permissions).toBe(42)
    expect(report.roles).toBe(4)
    expect(report.rolePermissions).toEqual({
      super_admin: 42,
      content_admin: 32,
      content_editor: 22,
      auditor: 12,
    })
    expect(await count("SELECT COUNT(*) AS n FROM admin_role_permissions")).toBe(108)
  })

  it("auditor 无任何写权限（只读 + imports.preview）", async () => {
    const db = makeDb(pool)
    const rows = await db
      .select({ code: schema.adminPermissions.code, action: schema.adminPermissions.action })
      .from(schema.adminRolePermissions)
      .innerJoin(schema.adminRoles, eq(schema.adminRolePermissions.roleId, schema.adminRoles.id))
      .innerJoin(schema.adminPermissions, eq(schema.adminRolePermissions.permissionId, schema.adminPermissions.id))
      .where(eq(schema.adminRoles.code, "auditor"))
    const actions = rows.map((r) => r.action)
    expect(actions.sort()).toEqual(
      ["read", "read", "read", "read", "read", "read", "read", "read", "read", "read", "read", "preview"].sort(),
    )
    expect(actions).not.toContain("create")
    expect(actions).not.toContain("update")
    expect(actions).not.toContain("delete")
    expect(actions).not.toContain("publish")
    expect(actions).not.toContain("disable")
    expect(actions).not.toContain("assign_role")
    expect(actions).not.toContain("execute")
  })

  it("content_editor 无发布/删除/管理员权限", async () => {
    const db = makeDb(pool)
    const rows = await db
      .select({ action: schema.adminPermissions.action })
      .from(schema.adminRolePermissions)
      .innerJoin(schema.adminRoles, eq(schema.adminRolePermissions.roleId, schema.adminRoles.id))
      .innerJoin(schema.adminPermissions, eq(schema.adminRolePermissions.permissionId, schema.adminPermissions.id))
      .where(eq(schema.adminRoles.code, "content_editor"))
    const actions = rows.map((r) => r.action)
    for (const banned of ["publish", "delete", "disable", "assign_role", "execute"]) {
      expect(actions).not.toContain(banned)
    }
    expect(actions.filter((a) => a === "read")).toHaveLength(8) // dashboard + 7 内容资源
  })

  it("content_admin 无管理员/设置/导入权限", async () => {
    const db = makeDb(pool)
    const rows = await db
      .select({ resource: schema.adminPermissions.resource })
      .from(schema.adminRolePermissions)
      .innerJoin(schema.adminRoles, eq(schema.adminRolePermissions.roleId, schema.adminRoles.id))
      .innerJoin(schema.adminPermissions, eq(schema.adminRolePermissions.permissionId, schema.adminPermissions.id))
      .where(eq(schema.adminRoles.code, "content_admin"))
    const resources = rows.map((r) => r.resource)
    expect(resources).not.toContain("administrators")
    expect(resources).not.toContain("settings")
    expect(resources).not.toContain("imports")
    expect(resources).not.toContain("audit_logs")
  })

  it("seed 不破坏既有管理员与自定义角色", async () => {
    const db = makeDb(pool)
    // 预置：一个自定义（非系统）角色 + 一个关联了它的管理员
    await db.insert(schema.adminRoles).values({ code: "custom_publisher", name: "自定义发布", isSystem: false })
    await db
      .insert(schema.adminUsers)
      .values({ username: "custom-user", passwordHash: "not-a-real-hash", displayName: "Custom" })
    const [role] = await db.select({ id: schema.adminRoles.id }).from(schema.adminRoles).where(eq(schema.adminRoles.code, "custom_publisher"))
    const [user] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(eq(schema.adminUsers.username, "custom-user"))
    const [perm] = await db
      .select({ id: schema.adminPermissions.id })
      .from(schema.adminPermissions)
      .where(eq(schema.adminPermissions.code, "links.publish"))
    await db.insert(schema.adminUserRoles).values({ userId: user.id, roleId: role.id })
    await db.insert(schema.adminRolePermissions).values({ roleId: role.id, permissionId: perm.id })

    await runSeedRbac(db) // 再跑一次

    // 自定义角色的权限保留（未被 seed 触碰）
    const kept = await db
      .select({ code: schema.adminPermissions.code })
      .from(schema.adminRolePermissions)
      .innerJoin(schema.adminRoles, eq(schema.adminRolePermissions.roleId, schema.adminRoles.id))
      .innerJoin(schema.adminPermissions, eq(schema.adminRolePermissions.permissionId, schema.adminPermissions.id))
      .where(eq(schema.adminRoles.code, "custom_publisher"))
    expect(kept.map((r) => r.code)).toEqual(["links.publish"])
    // 管理员未被动
    const [u2] = await db
      .select({ id: schema.adminUsers.id, mustChangePassword: schema.adminUsers.mustChangePassword })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.username, "custom-user"))
    expect(u2.id).toBe(user.id)
  })
})
