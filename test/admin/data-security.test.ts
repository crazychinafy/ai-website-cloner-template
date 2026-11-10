// P3 安全测试：数据安全（数据库存储形态 / Cookie 属性 / 响应与日志脱敏 / 前台 Cookie 隔离）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { adminSessions, adminUsers } from "../../src/lib/db/schema"
import { hashSessionToken } from "../../src/lib/admin/auth/session.ts"
import { serializeSessionCookie } from "../../src/lib/admin/auth/cookies.ts"
import {
  adminCookie,
  adminReq,
  cookieToken,
  createTestAdmin,
  forgedFrontendSession,
  setupP3Env,
  setNodeEnv,
  teardownP3Env,
  type P3Env,
} from "./test-admin"

let env: P3Env
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loginRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionRoute: any

const KNOWN_PASSWORD = "DataSec-Pass-12345"

beforeAll(async () => {
  env = await setupP3Env()
  loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  sessionRoute = await import("../../src/app/api/admin/v1/auth/session/route")
  await createTestAdmin(env.db, { username: "datasec_admin", roles: ["super_admin"], password: KNOWN_PASSWORD })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

async function loginOnce(): Promise<{ token: string }> {
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "datasec_admin", password: KNOWN_PASSWORD } }),
  )
  expect(res.status).toBe(200)
  return { token: cookieToken(res)! }
}

describe("数据安全", () => {
  it("1. Session：数据库只存 SHA-256 摘要（token_hash = hash(cookie 原始值)，库中无原始 token）", async () => {
    const { token } = await loginOnce()
    const hash = hashSessionToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/) // 64 位十六进制
    const rows = await env.db.select().from(adminSessions).where(eq(adminSessions.tokenHash, hash)).limit(1)
    expect(rows).toHaveLength(1) // 摘要命中
    expect(rows[0]!.tokenHash).not.toBe(token) // 摘要 ≠ 原始
    // 全表扫描：原始 token 不出现在 token_hash 列
    const all = await env.db.select({ tokenHash: adminSessions.tokenHash }).from(adminSessions)
    expect(all.every((r) => r.tokenHash !== token)).toBe(true)
  })

  it("2. 登录响应 Set-Cookie 带 HttpOnly（浏览器 JS 不可读）", async () => {
    const res = await loginRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "datasec_admin", password: KNOWN_PASSWORD } }),
    )
    const sc = res.headers.get("set-cookie") ?? ""
    expect(sc).toMatch(/;[ \t]*HttpOnly/i)
  })

  it("3. 生产环境 Cookie 带 Secure；开发环境不带（避免本地 http 调试被破坏）", async () => {
    const saved = process.env.NODE_ENV
    try {
      setNodeEnv("production")
      expect(serializeSessionCookie("tok", 3600)).toContain("Secure")
    } finally {
      setNodeEnv(saved)
    }
    expect(serializeSessionCookie("tok", 3600)).not.toContain("Secure") // 当前（开发/测试）
  })

  it("4. 管理员 Session token 不进入任何 API 响应正文（登录/会话查询）", async () => {
    const { token } = await loginOnce()
    const loginJson = (await loginRoute.POST(
      adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "datasec_admin", password: KNOWN_PASSWORD } }),
    ).then((r: Response) => r.text()))
    expect(loginJson).not.toContain(token)
    const sessJson = (await sessionRoute.GET(adminReq({ path: "/api/admin/v1/auth/session", cookie: adminCookie(token) })).then((r: Response) => r.text()))
    expect(sessJson).not.toContain(token)
    expect(sessJson).not.toContain("password_hash")
  })

  it("5. 密码仅以 Argon2id 哈希存储（库中无明文；前缀 $argon2id$）", async () => {
    const rows = await env.db
      .select({ passwordHash: adminUsers.passwordHash })
      .from(adminUsers)
      .where(eq(adminUsers.username, "datasec_admin"))
      .limit(1)
    expect(rows[0]!.passwordHash).toMatch(/^\$argon2id\$/)
    expect(rows[0]!.passwordHash).not.toContain(KNOWN_PASSWORD) // 明文不在哈希里
    const all = await env.db.select({ passwordHash: adminUsers.passwordHash }).from(adminUsers)
    expect(all.every((r) => !r.passwordHash.includes(KNOWN_PASSWORD))).toBe(true)
  })

  it("6. 服务端日志不出现明文密码 / Session token（失败登录 + 失败改密全链路）", async () => {
    const logged: string[] = []
    const origError = console.error
    const origWarn = console.warn
    console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "))
    console.warn = (...a: unknown[]) => logged.push(a.map(String).join(" "))
    try {
      const { token } = await loginOnce()
      // 失败改密（错误旧密码）
      const csrf = ((await sessionRoute
        .GET(adminReq({ path: "/api/admin/v1/auth/session", cookie: adminCookie(token) }))
        .then((r: Response) => r.json())) as { data: { csrfToken: string } }).data.csrfToken
      await import("../../src/app/api/admin/v1/auth/change-password/route").then(async (m) => {
        await m.POST(
          adminReq({
            method: "POST",
            path: "/api/admin/v1/auth/change-password",
            cookie: adminCookie(token),
            csrf,
            body: { oldPassword: "Totally-Wrong-123", newPassword: "Brand-New-Pass-123", confirmPassword: "Brand-New-Pass-123" },
          }),
        )
      })
      // 失败登录
      await loginRoute.POST(
        adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username: "datasec_admin", password: "Totally-Wrong-123" } }),
      )
    } finally {
      console.error = origError
      console.warn = origWarn
    }
    const all = logged.join("\n")
    expect(all).not.toContain("DataSec-Pass-12345") // 登录密码
    expect(all).not.toContain("Totally-Wrong-123") // 改密旧密码
    expect(all).not.toContain("Brand-New-Pass-123") // 新密码
    // 原始 token（43 位 base64url）不应以任何形式出现在日志
    const b64url = all.match(/[A-Za-z0-9_-]{43}/g) ?? []
    expect(b64url.length).toBe(0)
    // token_hash 列只有摘要，绝不含原始 token
    const sessions = await env.db.select({ tokenHash: adminSessions.tokenHash }).from(adminSessions)
    const { token } = await loginOnce()
    expect(sessions.every((r: { tokenHash: string }) => r.tokenHash !== token)).toBe(true)
  })

  it("7. 前台 facai8_session（Base64 Mock）与管理员 Cookie 完全隔离：单独伪造前台 Cookie 不能进入后台", async () => {
    const res = await sessionRoute.GET(adminReq({ path: "/api/admin/v1/auth/session", cookie: forgedFrontendSession("datasec_admin") }))
    expect(res.status).toBe(401)
    // 前台 Cookie 与管理员 Cookie 同时存在时，也只认管理员 Cookie（身份 = 管理员，伪造前台 Cookie 被忽略）
    const { token } = await loginOnce()
    const res2 = await sessionRoute.GET(
      adminReq({ path: "/api/admin/v1/auth/session", cookie: `${adminCookie(token)}; ${forgedFrontendSession("someone_else")}` }),
    )
    expect(res2.status).toBe(200)
    const json = (await res2.json()) as { data: { username: string } }
    expect(json.data.username).toBe("datasec_admin")
  })
})
