// P3 认证测试（三）：Session 会话管理（查询 / 过期 / 撤销 / 禁用即时生效 / 注销 / 冒充防御）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { adminSessions, adminUsers } from "../../src/lib/db/schema"
import { addSecondsString, hashSessionToken, utcNowString } from "../../src/lib/admin/auth/session.ts"
import {
  adminCookie,
  adminReq,
  cookieToken,
  createTestAdmin,
  forgedFrontendSession,
  setupP3Env,
  teardownP3Env,
  type P3Env,
} from "./test-admin"

let env: P3Env
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loginRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let logoutRoute: any

beforeAll(async () => {
  env = await setupP3Env()
  loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  sessionRoute = await import("../../src/app/api/admin/v1/auth/session/route")
  logoutRoute = await import("../../src/app/api/admin/v1/auth/logout/route")
  await createTestAdmin(env.db, { username: "sess_admin", roles: ["super_admin"], password: "Sess-Pass-12345" })
  await createTestAdmin(env.db, { username: "sess_editor", roles: ["content_editor"], password: "Editor-Pass-1234" })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

/** 登录并取回 token */
async function login(username: string, password: string): Promise<string> {
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password } }),
  )
  expect(res.status).toBe(200)
  const token = cookieToken(res)
  expect(token).toBeTruthy()
  return token!
}

const getSession = (cookie: string) => sessionRoute.GET(adminReq({ path: "/api/admin/v1/auth/session", cookie }))

describe("Session 会话管理", () => {
  it("1. 未登录（无 Cookie）访问会话 API → 401", async () => {
    const res = await getSession("")
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe("UNAUTHORIZED")
  })

  it("2. 仅伪造前台 facai8_session（Base64 Mock）→ 401（前台会话不能冒充管理员）", async () => {
    const res = await getSession(forgedFrontendSession("admin"))
    expect(res.status).toBe(401)
  })

  it("3. 有效 Session → 200 返回身份/角色/权限/CSRF；不返回 token 与密码哈希", async () => {
    const token = await login("sess_admin", "Sess-Pass-12345")
    const res = await getSession(adminCookie(token))
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown> & {
      data: {
        id: string
        username: string
        roles: string[]
        permissions: string[]
        mustChangePassword: boolean
        csrfToken: string
        expiresAt: string
      }
    }
    expect(json.success).toBe(true)
    expect(json.data.username).toBe("sess_admin")
    expect(json.data.id).toMatch(/^\d+$/) // BIGINT 字符串
    expect(json.data.roles).toEqual(["super_admin"])
    expect(json.data.permissions).toContain("dashboard.read")
    expect(json.data.permissions.length).toBe(46) // super_admin = 全部权限（P6A 后 46 条）
    expect(json.data.mustChangePassword).toBe(false)
    expect(json.data.csrfToken.length).toBeGreaterThan(0)
    expect(json.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
    // 敏感字段断言：正文不含原始 token、不含 password_hash
    const body = JSON.stringify(json)
    expect(body).not.toContain(token)
    expect(body).not.toContain("password_hash")
    expect(body).not.toContain("passwordHash")
  })

  it("4. Session 过期 → 401（expires_at 回拨到过去后，同一 Cookie 立即失效）", async () => {
    const token = await login("sess_admin", "Sess-Pass-12345")
    await env.db
      .update(adminSessions)
      .set({ expiresAt: addSecondsString(utcNowString(), -60) })
      .where(eq(adminSessions.tokenHash, hashSessionToken(token)))
    const res = await getSession(adminCookie(token))
    expect(res.status).toBe(401)
  })

  it("5. Session 撤销（revoked_at 置位）→ 401", async () => {
    const token = await login("sess_admin", "Sess-Pass-12345")
    await env.db
      .update(adminSessions)
      .set({ revokedAt: utcNowString() })
      .where(eq(adminSessions.tokenHash, hashSessionToken(token)))
    const res = await getSession(adminCookie(token))
    expect(res.status).toBe(401)
  })

  it("6. 管理员登录后被禁用 → 旧 Session 下一次请求立即 401；重新启用后恢复（每次请求实时检查）", async () => {
    const token = await login("sess_admin", "Sess-Pass-12345")
    const user = await env.db.select().from(adminUsers).where(eq(adminUsers.username, "sess_admin")).limit(1)
    const id = user[0]!.id

    await env.db.update(adminUsers).set({ status: "disabled" }).where(eq(adminUsers.id, id))
    expect((await getSession(adminCookie(token))).status).toBe(401) // 禁用立即生效

    await env.db.update(adminUsers).set({ status: "active" }).where(eq(adminUsers.id, id))
    expect((await getSession(adminCookie(token))).status).toBe(200) // 恢复同样立即生效
  })

  it("7. 注销 → 撤销 DB Session + 清 Cookie；旧 Cookie 重放 401；二次注销幂等 200", async () => {
    const token = await login("sess_admin", "Sess-Pass-12345")
    // 先取 CSRF（注销是写操作）
    const csrf = ((await getSession(adminCookie(token)).then((r: Response) => r.json())) as { data: { csrfToken: string } }).data.csrfToken

    const out = await logoutRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/logout", cookie: adminCookie(token), csrf, body: {} }),
    )
    expect(out.status).toBe(200)
    expect((out.headers.get("set-cookie") ?? "").toLowerCase()).toContain("max-age=0") // Cookie 清除

    const row = await env.db
      .select({ revokedAt: adminSessions.revokedAt })
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, hashSessionToken(token)))
      .limit(1)
    expect(row[0]!.revokedAt).toBeTruthy() // DB 已撤销

    expect((await getSession(adminCookie(token))).status).toBe(401) // 旧 token 重放失效

    const again = await logoutRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/logout", cookie: adminCookie(token), csrf, body: {} }),
    )
    expect(again.status).toBe(200) // 幂等：Session 已无效时仍成功清理
  })

  it("8. 移除管理员角色后权限立即刷新（下一次请求按最新权限返回）", async () => {
    const token = await login("sess_editor", "Editor-Pass-1234")
    const r1 = (await getSession(adminCookie(token)).then((r: Response) => r.json())) as { data: { roles: string[]; permissions: string[] } }
    expect(r1.data.roles).toEqual(["content_editor"])
    expect(r1.data.permissions).toContain("articles.update")

    // 删除角色关联（模拟管理员被移除角色 —— P5 的操作，这里直接改库模拟）
    const user = await env.db.select().from(adminUsers).where(eq(adminUsers.username, "sess_editor")).limit(1)
    const { adminUserRoles } = await import("../../src/lib/db/schema")
    await env.db.delete(adminUserRoles).where(eq(adminUserRoles.userId, user[0]!.id))

    const r2 = (await getSession(adminCookie(token)).then((r: Response) => r.json())) as { data: { roles: string[]; permissions: string[] } }
    expect(r2.data.roles).toEqual([]) // 会话仍有效（active），但权限集已实时收缩
    expect(r2.data.permissions).toEqual([])
  })
})
