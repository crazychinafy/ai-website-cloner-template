// P3 安全测试：CSRF 防护（Origin 白名单 + X-CSRF-Token HMAC + 失败关闭）
// 覆盖：合法来源+合法 token、非法来源、缺 token、错 token、跨站、
// 生产未配置密钥、通配符白名单 —— 写请求（登录/注销/改密）全链路。
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminReq, createTestAdmin, setupP3Env, setNodeEnv, teardownP3Env, type P3Env } from "./test-admin"

let env: P3Env
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loginRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let logoutRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let changePwdRoute: any

const EVIL_ORIGIN = "https://evil.example"

beforeAll(async () => {
  env = await setupP3Env()
  loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  logoutRoute = await import("../../src/app/api/admin/v1/auth/logout/route")
  changePwdRoute = await import("../../src/app/api/admin/v1/auth/change-password/route")
  await createTestAdmin(env.db, { username: "csrf_admin", roles: ["super_admin"], password: "Csrf-Pass-12345" })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

/** 登录 → 取 token + csrf（同源） */
async function establishSession(): Promise<{ token: string; csrf: string }> {
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "csrf_admin", password: "Csrf-Pass-12345" } }),
  )
  expect(res.status).toBe(200)
  const token = res.headers.get("set-cookie")!.split(";")[0]!.split("=").slice(1).join("=")
  const sess = (await import("../../src/lib/admin/services/admin-auth-service.ts"))
  const identity = await sess.getSession(
    adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` }),
  )
  return { token, csrf: identity.data.csrfToken }
}

describe("CSRF 防护（写请求）", () => {
  it("1. 合法来源 + 合法 CSRF token（注销）→ 200", async () => {
    const { token, csrf } = await establishSession()
    const res = await logoutRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/logout", cookie: `facai8_admin_session=${token}`, csrf, body: {} }),
    )
    expect(res.status).toBe(200)
  })

  it("2. 非法 Origin（不在白名单）+ 合法 token → 403", async () => {
    const { token, csrf } = await establishSession()
    const res = await logoutRoute.POST(
      adminReq({
        method: "POST",
        path: "/api/admin/v1/auth/logout",
        cookie: `facai8_admin_session=${token}`,
        csrf,
        origin: EVIL_ORIGIN,
        body: {},
      }),
    )
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe("CSRF_INVALID")
  })

  it("3. 合法来源但缺少 X-CSRF-Token → 403", async () => {
    const { token } = await establishSession()
    const res = await logoutRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/logout", cookie: `facai8_admin_session=${token}`, body: {} }),
    )
    expect(res.status).toBe(403)
  })

  it("4. 合法来源但 token 错误（伪造 HMAC 输出）→ 403", async () => {
    const { token } = await establishSession()
    const bogus = "A".repeat(43) // 与合法 token 等长的错误值
    const res = await logoutRoute.POST(
      adminReq({
        method: "POST",
        path: "/api/admin/v1/auth/logout",
        cookie: `facai8_admin_session=${token}`,
        csrf: bogus,
        body: {},
      }),
    )
    expect(res.status).toBe(403)
  })

  it("5. 跨站请求（他站 Origin，即使携带正确 token 值也无法从跨站上下文获得 —— 来源校验先行拒绝）", async () => {
    // 构造：先同源登录拿到 csrf，再以他站 Origin 重放
    const { token, csrf } = await establishSession()
    const res = await changePwdRoute.POST(
      adminReq({
        method: "POST",
        path: "/api/admin/v1/auth/change-password",
        cookie: `facai8_admin_session=${token}`,
        csrf,
        origin: EVIL_ORIGIN,
        body: { oldPassword: "x", newPassword: "y", confirmPassword: "y" },
      }),
    )
    // 来源校验在 CSRF/会话之前 → 403（不泄露会话是否存在）
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CSRF_INVALID")
  })

  it("6. 生产环境未配置 ADMIN_CSRF_SECRET → fail-closed（认证操作 401，恢复后 200，不泄露内部细节）", async () => {
    const res = await loginRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "csrf_admin", password: "Csrf-Pass-12345" } }),
    )
    expect(res.status).toBe(200) // 登录不依赖 CSRF 密钥
    const token = res.headers.get("set-cookie")!.split(";")[0]!.split("=").slice(1).join("=")

    const savedNodeEnv = process.env.NODE_ENV
    const savedSecret = process.env.ADMIN_CSRF_SECRET
    setNodeEnv("production")
    delete process.env.ADMIN_CSRF_SECRET
    try {
      const svc = await import("../../src/lib/admin/services/admin-auth-service.ts")
      // 会话查询依赖密钥派生 CSRF token：密钥缺失 → 验证失败 → 401（通用文案，不泄露原因）
      await expect(
        svc.getSession(adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` })),
      ).rejects.toMatchObject({ status: 401 })
      const cpRes = await changePwdRoute.POST(
        adminReq({
          method: "POST",
          path: "/api/admin/v1/auth/change-password",
          cookie: `facai8_admin_session=${token}`,
          body: { oldPassword: "Csrf-Pass-12345", newPassword: "Newer-Pass-12345", confirmPassword: "Newer-Pass-12345" },
        }),
      )
      expect(cpRes.status).toBe(401)
      const msg = ((await cpRes.json()) as { error: { message: string } }).error.message
      expect(msg).not.toContain("ADMIN_CSRF_SECRET")
      expect(msg).not.toContain("secret")
    } finally {
      setNodeEnv(savedNodeEnv)
      if (savedSecret === undefined) delete process.env.ADMIN_CSRF_SECRET
      else process.env.ADMIN_CSRF_SECRET = savedSecret
    }
    // 恢复配置后同一 Cookie 立即恢复可用
    const sess = (await import("../../src/lib/admin/services/admin-auth-service.ts"))
    const identity = await sess.getSession(adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` }))
    expect(identity.data.username).toBe("csrf_admin")
  })

  it("7. ADMIN_ALLOWED_ORIGINS 含通配符 * → 配置非法，fail-closed（403 而非放行）", async () => {
    const saved = process.env.ADMIN_ALLOWED_ORIGINS
    process.env.ADMIN_ALLOWED_ORIGINS = "https://admin.test,https://evil.example,*"
    try {
      const { token } = await establishSession()
      // 他站 Origin + 通配符白名单（非法配置）→ allowedOrigins() 抛错被捕获 → 拒绝
      const res = await logoutRoute.POST(
        adminReq({
          method: "POST",
          path: "/api/admin/v1/auth/logout",
          cookie: `facai8_admin_session=${token}`,
          origin: EVIL_ORIGIN,
          csrf: "A".repeat(43),
          body: {},
        }),
      )
      expect(res.status).toBe(403)
    } finally {
      if (saved === undefined) delete process.env.ADMIN_ALLOWED_ORIGINS
      else process.env.ADMIN_ALLOWED_ORIGINS = saved
    }
  })
})
