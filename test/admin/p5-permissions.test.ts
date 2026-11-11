// P5 测试：RBAC 权限矩阵 × P5 UI 层（真实 MySQL scratch 库 facai8_p5_test）
// - 真实登录（route handler）→ Session 接口核对四角色权限集（42/32/22/12，与 P2 Seed 一致）
// - buildNav 可见性矩阵（菜单展示 ≠ 授权；服务端守卫是唯一安全边界）
// - requireAdminPermission 跨角色 403（直接调用统一守卫，模拟"绕过隐藏菜单"）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  adminReq,
  createTestAdmin,
  setupP5Env,
  teardownP5Env,
  type P5Env,
} from "./p5-harness"
import { buildNav, isNavGroup } from "../../src/lib/admin/ui/navigation"
import { requireAdminPermission } from "../../src/lib/admin/permissions/require-permission.ts"

const PASSWORD = "P5-Pass-12345"

let env: P5Env

beforeAll(async () => {
  env = await setupP5Env()
  await createTestAdmin(env.db, { username: "p5_super", roles: ["super_admin"], password: PASSWORD })
  await createTestAdmin(env.db, { username: "p5_content", roles: ["content_admin"], password: PASSWORD })
  await createTestAdmin(env.db, { username: "p5_editor", roles: ["content_editor"], password: PASSWORD })
  await createTestAdmin(env.db, { username: "p5_auditor", roles: ["auditor"], password: PASSWORD })
}, 150_000)

afterAll(async () => {
  await teardownP5Env(env)
})

/** 登录并取 Cookie 头（直接驱动 route handler，无需起服务） */
async function loginCookie(username: string): Promise<string> {
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: PASSWORD } }),
  )
  expect(res.status, `login ${username}`).toBe(200)
  const sc = res.headers.get("set-cookie")
  expect(sc, `login ${username} 应下发 session cookie`).toBeTruthy()
  const first = sc!.split(";")[0]
  const token = first!.split("=").slice(1).join("=")
  return `facai8_admin_session=${token}`
}

/** 查询当前会话（GET /api/admin/v1/auth/session；权限每次请求实时加载） */
async function getSession(cookie: string) {
  const sessionRoute = await import("../../src/app/api/admin/v1/auth/session/route")
  const res = await sessionRoute.GET(adminReq({ path: "/api/admin/v1/auth/session", cookie }))
  expect(res.status).toBe(200)
  return (await res.json()) as { data: { roles: string[]; permissions: string[] } }
}

describe("P5 RBAC × UI 权限矩阵（真实 DB 核对）", () => {
  it("1. 四个标准角色 Session 权限数 = 42/32/22/12（与 P2 Seed 字典一致）", async () => {
    const cases: Array<[string, string, number]> = [
      ["p5_super", "super_admin", 42],
      ["p5_content", "content_admin", 32],
      ["p5_editor", "content_editor", 22],
      ["p5_auditor", "auditor", 12],
    ]
    for (const [user, role, n] of cases) {
      const id = await getSession(await loginCookie(user))
      expect(id.data.roles, user).toEqual([role])
      expect(id.data.permissions.length, `${user} 权限数`).toBe(n)
    }
  })

  it("2. buildNav：super_admin 全量 4 个顶层（工作台 + 3 组，14 项）", async () => {
    const id = await getSession(await loginCookie("p5_super"))
    const nav = buildNav(id.data.permissions)
    expect(nav.map((n) => n.label)).toEqual(["工作台", "内容管理", "运营管理", "系统管理"])
    const all = nav.flatMap((n) => (isNavGroup(n) ? [n.label, ...n.items.map((i) => i.label)] : [n.label]))
    // 14 个条目 + 3 个分组标签 = 17（labels 含分组标签）
    expect(all).toHaveLength(17)
    expect(all).toContain("管理员管理")
    expect(all).toContain("数据导入")
  })

  it("3. buildNav：content_admin / content_editor 无系统组（无 administrators/audit_logs/imports）", async () => {
    for (const user of ["p5_content", "p5_editor"]) {
      const id = await getSession(await loginCookie(user))
      const nav = buildNav(id.data.permissions)
      expect(nav.map((n) => n.label), user).toEqual(["工作台", "内容管理", "运营管理"])
      const labels = nav.flatMap((n) => (isNavGroup(n) ? n.items.map((i) => i.label) : [n.label]))
      for (const l of ["管理员管理", "角色权限", "操作日志", "数据导入", "站点设置"]) {
        expect(labels, `${user} 不应含 ${l}`).not.toContain(l)
      }
    }
  })

  it("4. buildNav：auditor 只读可见全部模块（含系统组只读项）", async () => {
    const id = await getSession(await loginCookie("p5_auditor"))
    const nav = buildNav(id.data.permissions)
    expect(nav.map((n) => n.label)).toEqual(["工作台", "内容管理", "运营管理", "系统管理"])
    const labels = nav.flatMap((n) => (isNavGroup(n) ? n.items.map((i) => i.label) : [n.label]))
    for (const l of ["站点设置", "管理员管理", "操作日志", "数据导入"]) {
      expect(labels, `auditor 应含 ${l}`).toContain(l)
    }
  })

  it("5. 菜单隐藏 ≠ 授权：editor 直调 administrators.read 守卫 → 403 FORBIDDEN；super_admin → 通过", async () => {
    const editor = await loginCookie("p5_editor")
    const denied = await requireAdminPermission(
      adminReq({ method: "GET", path: "/api/admin/v1/administrators", cookie: editor }),
      "administrators.read",
      env.db,
    )
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
      expect(((await denied.response.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN")
    }

    const superCookie = await loginCookie("p5_super")
    const allowed = await requireAdminPermission(
      adminReq({ method: "GET", path: "/api/admin/v1/administrators", cookie: superCookie }),
      "administrators.read",
      env.db,
    )
    expect(allowed.ok).toBe(true)
  })

  it("6. auditor 只读：links.update → 403；links.read → 通过", async () => {
    const auditor = await loginCookie("p5_auditor")
    const denied = await requireAdminPermission(
      adminReq({ method: "PUT", path: "/api/admin/v1/links/1", cookie: auditor }),
      "links.update",
      env.db,
    )
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.response.status).toBe(403)
      expect(((await denied.response.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN")
    }

    const allowed = await requireAdminPermission(
      adminReq({ method: "GET", path: "/api/admin/v1/links", cookie: auditor }),
      "links.read",
      env.db,
    )
    expect(allowed.ok).toBe(true)
  })
})
