// P3 认证测试（一）：管理员登录
// 覆盖：正确/错误密码、不存在账号、disabled、locked、软删除、强制改密标志、
// 请求格式校验、last_login_at 更新、Session 入库字段、轮换、Cookie 属性。
// 直接驱动 route handler（真实代码路径：Origin/JSON/Zod/限流/Argon2/Session）。
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { adminSessions, adminUsers } from "../../src/lib/db/schema"
import { hashSessionToken } from "../../src/lib/admin/auth/session.ts"
import { adminReq, cookieToken, createTestAdmin, setupP3Env, teardownP3Env, type P3Env } from "./test-admin"

let env: P3Env
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loginRoute: any

const LOGIN_PATH = "/api/admin/v1/auth/login"

beforeAll(async () => {
  env = await setupP3Env()
  loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  await createTestAdmin(env.db, { username: "alice", roles: ["super_admin"], password: "Alice-Pass-12345" })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

const post = (body: unknown, opts?: Partial<Parameters<typeof adminReq>[0]>) =>
  loginRoute.POST(adminReq({ method: "POST", path: LOGIN_PATH, body, ...opts }))

const errMsg = async (res: Response): Promise<{ code: string; message: string }> => {
  const j = (await res.json()) as { error: { code: string; message: string } }
  return j.error
}

describe("登录认证", () => {
  it("1. 正确管理员账号 + 密码 → 200 返回身份；token 只进 Cookie 不进 JSON", async () => {
    const fresh = await createTestAdmin(env.db, { username: "alice_ok", roles: ["super_admin"], password: "S3cret-Login-Value" })
    const res = await post({ username: fresh.username, password: fresh.password })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.username).toBe("alice_ok")
    expect(json.data.id).toBe(String(fresh.id))
    expect(json.data.displayName).toBe("alice_ok（测试）")
    expect(json.data.mustChangePassword).toBe(false)
    expect(typeof json.requestId).toBe("string")
    expect(res.headers.get("set-cookie")).toContain("facai8_admin_session=")
    // 响应正文不得包含明文密码，也不得包含 token 值
    const token = cookieToken(res)!
    const body = JSON.stringify(json)
    expect(body).not.toContain("S3cret-Login-Value")
    expect(body).not.toContain(token)
  })

  it("2. 错误密码 → 401 统一文案，且不建立 Session", async () => {
    const fresh = await createTestAdmin(env.db, { username: "bob_pwd", roles: ["super_admin"], password: "Right-Pass-12345" })
    const res = await post({ username: fresh.username, password: "Wrong-Pass-12345" })
    expect(res.status).toBe(401)
    const e = await errMsg(res)
    expect(e.code).toBe("UNAUTHORIZED")
    expect(e.message).toBe("用户名或密码错误")
    expect(res.headers.get("set-cookie")).toBeNull()
    const rows = await env.db.select().from(adminSessions).where(eq(adminSessions.userId, fresh.id))
    expect(rows).toHaveLength(0) // 失败不创建 Session
  })

  it("3. 不存在的管理员 → 401，且与错误密码的对外响应一致（防账号枚举）", async () => {
    const fresh = await createTestAdmin(env.db, { username: "carol_enum", roles: ["super_admin"], password: "Real-Pass-12345" })
    const r1 = await post({ username: fresh.username, password: "no-such-pass-11" })
    const r2 = await post({ username: "no_such_admin_zzz", password: "no-such-pass-11" })
    expect(r1.status).toBe(401)
    expect(r2.status).toBe(401)
    const j1 = (await r1.json()) as Record<string, unknown>
    const j2 = (await r2.json()) as Record<string, unknown>
    j1.requestId = j2.requestId = "x" // 排除每次请求唯一的 requestId
    expect(j1).toEqual(j2) // 其余字段（success/error 信封）逐字节一致
  })

  it("4. disabled 管理员（密码正确）→ 401 统一文案，不建立 Session", async () => {
    const user = await createTestAdmin(env.db, {
      username: "bob_disabled2",
      roles: ["super_admin"],
      status: "disabled",
      password: "Known-Pass-12345",
    })
    const res = await post({ username: user.username, password: user.password })
    expect(res.status).toBe(401)
    expect((await errMsg(res)).message).toBe("用户名或密码错误")
    const sessions = await env.db.select().from(adminSessions).where(eq(adminSessions.userId, user.id))
    expect(sessions).toHaveLength(0)
  })

  it("5. locked 管理员（密码正确）→ 401 统一文案，不建立 Session", async () => {
    const user = await createTestAdmin(env.db, {
      username: "carol_lock2",
      roles: ["super_admin"],
      status: "locked",
      password: "Known-Pass-12345",
    })
    const res = await post({ username: user.username, password: user.password })
    expect(res.status).toBe(401)
    expect((await errMsg(res)).message).toBe("用户名或密码错误")
    const sessions = await env.db.select().from(adminSessions).where(eq(adminSessions.userId, user.id))
    expect(sessions).toHaveLength(0)
  })

  it("6. 已软删除管理员（密码正确）→ 401 统一文案，不建立 Session", async () => {
    const user = await createTestAdmin(env.db, {
      username: "dave_del2",
      roles: ["super_admin"],
      deletedAt: "2026-11-01 00:00:00.000",
      password: "Known-Pass-12345",
    })
    const res = await post({ username: user.username, password: user.password })
    expect(res.status).toBe(401)
    expect((await errMsg(res)).message).toBe("用户名或密码错误")
    const sessions = await env.db.select().from(adminSessions).where(eq(adminSessions.userId, user.id))
    expect(sessions).toHaveLength(0)
  })

  it("7. must_change_password=1 → 200 且 data.mustChangePassword=true（引导改密）", async () => {
    const user = await createTestAdmin(env.db, {
      username: "erin_first2",
      roles: ["super_admin"],
      mustChangePassword: true,
      password: "First-Pass-12345",
    })
    const res = await post({ username: user.username, password: user.password })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { mustChangePassword: boolean } }
    expect(json.data.mustChangePassword).toBe(true)
    expect(cookieToken(res)).toBeTruthy()
  })

  it("8. 非法 JSON 请求体 → 400", async () => {
    const res = await loginRoute.POST(
      new Request("http://admin.test" + LOGIN_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://admin.test",
          host: "admin.test",
          "x-forwarded-for": "203.0.113.7",
        },
        body: "{not-json",
      }),
    )
    expect(res.status).toBe(400)
    expect((await errMsg(res)).code).toBe("VALIDATION_ERROR")
  })

  it("9. 非 JSON Content-Type → 400", async () => {
    const res = await loginRoute.POST(
      new Request("http://admin.test" + LOGIN_PATH, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "http://admin.test", host: "admin.test", "x-forwarded-for": "203.0.113.7" },
        body: "username=a&password=b",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("10. 参数校验失败 → 422 + fields（空用户名/空密码）", async () => {
    const res = await post({ username: "   ", password: "" })
    expect(res.status).toBe(422)
    const json = (await res.json()) as { error: { code: string; fields: Record<string, string> } }
    expect(json.error.code).toBe("VALIDATION_ERROR")
    expect(json.error.fields.username).toBeTruthy()
    expect(json.error.fields.password).toBeTruthy()
  })

  it("11. 登录成功更新 last_login_at；Session 行字段完整（过期=创建+TTL、UA/IP 留痕）", async () => {
    const user = await createTestAdmin(env.db, { username: "frank_login", roles: ["super_admin"], password: "Login-Time-12345" })
    const before = await env.db
      .select({ lastLoginAt: adminUsers.lastLoginAt })
      .from(adminUsers)
      .where(eq(adminUsers.id, user.id))
      .limit(1)
    expect(before[0]!.lastLoginAt).toBeNull()

    const res = await post({ username: user.username, password: user.password }, { userAgent: "p3-test/1.0" })
    expect(res.status).toBe(200)
    const token = cookieToken(res)!

    const after = await env.db
      .select({ lastLoginAt: adminUsers.lastLoginAt })
      .from(adminUsers)
      .where(eq(adminUsers.id, user.id))
      .limit(1)
    expect(after[0]!.lastLoginAt).toBeTruthy()

    const sess = await env.db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, hashSessionToken(token)))
      .limit(1)
    expect(sess).toHaveLength(1)
    expect(sess[0]!.userId).toBe(user.id)
    expect(sess[0]!.expiresAt > sess[0]!.createdAt).toBe(true) // 同格式定长墙钟字符串：字典序 = 时间序
    expect(sess[0]!.userAgent).toBe("p3-test/1.0")
    // drizzle 0.45 将 varbinary 声明为 string（读回 = 原始字节的 utf8 形态）：16 字节 = 16 字符
    expect(sess[0]!.ipAddress).not.toBeNull()
    expect(sess[0]!.ipAddress!.length).toBe(16)
    expect(sess[0]!.revokedAt).toBeNull()
  })

  it("12. 同一账号两次登录产生不同 token（登录即轮换，防 Session Fixation）", async () => {
    const user = await createTestAdmin(env.db, { username: "grace_rot", roles: ["super_admin"], password: "Rotate-Me-12345" })
    const r1 = await post({ username: user.username, password: user.password })
    const r2 = await post({ username: user.username, password: user.password })
    const t1 = cookieToken(r1)!
    const t2 = cookieToken(r2)!
    expect(t1).not.toBe(t2) // 每次登录都是全新随机 token
    const sessCount = await env.db.select().from(adminSessions).where(eq(adminSessions.userId, user.id))
    expect(sessCount).toHaveLength(2) // 两个有效会话（多设备可用）
  })

  it("13. Cookie 属性：HttpOnly / SameSite=Lax / Path=/ / Max-Age=12h / 无 Domain", async () => {
    const user = await createTestAdmin(env.db, { username: "heidi_cookie", roles: ["super_admin"], password: "Cookie-Attr-1234" })
    const res = await post({ username: user.username, password: user.password })
    const sc = (res.headers.get("set-cookie") ?? "").toLowerCase()
    expect(sc).toContain("httponly") // JS 不可读
    expect(sc).toContain("samesite=lax")
    expect(sc).toContain("path=/")
    const maxAge = Number(sc.match(/max-age=(\d+)/)?.[1])
    expect(maxAge).toBe(12 * 3600) // 默认 TTL 12h
    expect(sc).not.toContain("domain=") // 不设置不必要的 Domain
  })
})
