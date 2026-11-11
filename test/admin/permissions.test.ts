// P3 权限测试：RBAC 角色/权限（与 P2 Seed 权限字典核对）+ 统一守卫 401/403
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { adminRoles, adminUserRoles, adminUsers } from "../../src/lib/db/schema"
import {
  adminReq,
  createTestAdmin,
  setupP3Env,
  teardownP3Env,
  type P3Env,
} from "./test-admin"
import { requireAdminPermission } from "../../src/lib/admin/permissions/require-permission.ts"

let env: P3Env

beforeAll(async () => {
  env = await setupP3Env()
  await createTestAdmin(env.db, { username: "role_super", roles: ["super_admin"], password: "Role-Pass-12345" })
  await createTestAdmin(env.db, { username: "role_content_admin", roles: ["content_admin"], password: "Role-Pass-12345" })
  await createTestAdmin(env.db, { username: "role_editor", roles: ["content_editor"], password: "Role-Pass-12345" })
  await createTestAdmin(env.db, { username: "role_auditor", roles: ["auditor"], password: "Role-Pass-12345" })
  await createTestAdmin(env.db, { username: "role_mustchange", roles: ["super_admin"], mustChangePassword: true, password: "Role-Pass-12345" })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

/** 登录并取 cookie 头 */
async function loginCookie(username: string): Promise<string> {
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: "Role-Pass-12345" } }),
  )
  expect(res.status, `login ${username}`).toBe(200)
  const token = res.headers.get("set-cookie")!.split(";")[0]!.split("=").slice(1).join("=")
  return `facai8_admin_session=${token}`
}

const getIdentity = async (cookie: string) => {
  const sessionRoute = await import("../../src/app/api/admin/v1/auth/session/route")
  const res = await sessionRoute.GET(adminReq({ path: "/api/admin/v1/auth/session", cookie }))
  expect(res.status).toBe(200)
  return (await res.json()) as {
    data: { roles: string[]; permissions: string[]; mustChangePassword: boolean }
  }
}

describe("RBAC 角色权限（与 P2 Seed 字典核对）", () => {
  it("1. 四个标准角色的权限数量与字典一致（46/36/25/13，P6A 后）", async () => {
    const cases: Array<[string, string, number]> = [
      ["role_super", "super_admin", 46],
      ["role_content_admin", "content_admin", 36],
      ["role_editor", "content_editor", 25],
      ["role_auditor", "auditor", 13],
    ]
    for (const [user, role, n] of cases) {
      const id = await getIdentity(await loginCookie(user))
      expect(id.data.roles, user).toEqual([role])
      expect(id.data.permissions.length, `${user} 权限数`).toBe(n)
    }
  })

  it("2. content_admin 可管理内容，但无 administrators.* 与 settings.update 与 imports.execute", async () => {
    const id = await getIdentity(await loginCookie("role_content_admin"))
    expect(id.data.permissions).toContain("links.create")
    expect(id.data.permissions).toContain("links.delete")
    expect(id.data.permissions).toContain("dashboard.read")
    for (const p of ["administrators.read", "administrators.create", "administrators.update", "settings.update", "imports.execute"]) {
      expect(id.data.permissions, `不应含 ${p}`).not.toContain(p)
    }
  })

  it("3. content_editor 可编辑但无 *.publish / *.delete（发布与删除受限）", async () => {
    const id = await getIdentity(await loginCookie("role_editor"))
    expect(id.data.permissions).toContain("articles.create")
    expect(id.data.permissions).toContain("links.update")
    for (const p of ["links.publish", "links.delete", "articles.publish", "articles.delete", "bulletins.delete", "ads.delete"]) {
      expect(id.data.permissions, `不应含 ${p}`).not.toContain(p)
    }
  })

  it("4. auditor 只读（仅 *.read + imports.preview，无任何写权限）", async () => {
    const id = await getIdentity(await loginCookie("role_auditor"))
    expect(id.data.permissions).toContain("dashboard.read")
    expect(id.data.permissions).toContain("audit_logs.read")
    expect(id.data.permissions).toContain("imports.preview")
    const writes = id.data.permissions.filter((p) => !p.endsWith(".read") && p !== "imports.preview")
    expect(writes).toEqual([])
  })

  it("5. 直接调用守卫（绕过前端菜单）：editor 调 administrators.update → 403；super_admin → 通过", async () => {
    const editorCookie = await loginCookie("role_editor")
    const editorReq = adminReq({ method: "POST", path: "/api/admin/v1/administrators", cookie: editorCookie, body: {} })
    const denied = await requireAdminPermission(editorReq, "administrators.update", env.db)
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
      expect(((await denied.response.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN")
    }

    const superCookie = await loginCookie("role_super")
    const superReq = adminReq({ method: "POST", path: "/api/admin/v1/administrators", cookie: superCookie, body: {} })
    const allowed = await requireAdminPermission(superReq, "administrators.update", env.db)
    expect(allowed.ok).toBe(true)
  })

  it("6. must_change_password 未满足 → 业务权限守卫返回 403 CHANGE_PASSWORD_REQUIRED（改密前禁止进入业务）", async () => {
    const cookie = await loginCookie("role_mustchange")
    const req = adminReq({ method: "GET", path: "/api/admin/v1/links", cookie })
    const g = await requireAdminPermission(req, "links.read", env.db)
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.response.status).toBe(403)
      expect(((await g.response.json()) as { error: { code: string } }).error.code).toBe("CHANGE_PASSWORD_REQUIRED")
    }
  })

  it("7. 移除角色后下一次守卫调用立即 403（无缓存旧权限）；重新授予后立即恢复", async () => {
    const cookie = await loginCookie("role_editor")
    const user = await env.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.username, "role_editor"))
      .limit(1)
    const id = user[0]!.id

    await env.db.delete(adminUserRoles).where(eq(adminUserRoles.userId, id))
    const denied = await requireAdminPermission(adminReq({ method: "GET", path: "/api/admin/v1/links", cookie }), "links.read", env.db)
    expect(denied.ok).toBe(false) // 无角色 = 无任何权限

    // 重新授予 content_editor
    const role = await env.db
      .select({ id: adminRoles.id })
      .from(adminRoles)
      .where(eq(adminRoles.code, "content_editor"))
      .limit(1)
    await env.db.insert(adminUserRoles).values({ userId: id, roleId: role[0]!.id })
    const allowed = await requireAdminPermission(adminReq({ method: "GET", path: "/api/admin/v1/links", cookie }), "links.read", env.db)
    expect(allowed.ok).toBe(true)
  })
})
