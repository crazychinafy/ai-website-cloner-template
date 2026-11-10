// P3 认证测试（二）：登录限流与暴力破解防护
// 覆盖：用户名+IP 5 次/15min、IP 20 次/15min、429+Retry-After、窗口恢复、
// 成功留痕、不存在账号同样计数、过期记录清理。限流执行在服务端（admin_login_attempts）。
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { adminLoginAttempts } from "../../src/lib/db/schema"
import { addSecondsString, utcNowString } from "../../src/lib/admin/auth/session.ts"
import {
  adminReq,
  createTestAdmin,
  setupP3Env,
  teardownP3Env,
  type P3Env,
} from "./test-admin"

let env: P3Env
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loginRoute: any

const LOGIN_PATH = "/api/admin/v1/auth/login"

beforeAll(async () => {
  env = await setupP3Env()
  loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  await createTestAdmin(env.db, { username: "rl_admin", roles: ["super_admin"], password: "Rl-Pass-123456" })
}, 150_000)

afterAll(async () => {
  await teardownP3Env(env)
})

const failLogin = (username: string, xff: string) =>
  loginRoute.POST(
    adminReq({ method: "POST", path: LOGIN_PATH, body: { username, password: "Wrong-Pass-1" }, xff, origin: "http://admin.test" }),
  )

/** 表中失败记录数（直接查库断言；username=null 表示按 IP 聚合） */
const countFailures = async (username: string | null, xff: string) => {
  const { hashKey } = await import("../../src/lib/admin/auth/login.ts")
  const rows = await env.db
    .select({ c: sql<number>`count(*)` })
    .from(adminLoginAttempts)
    .where(
      username === null
        ? sql`ip_key = ${hashKey(xff)}`
        : sql`username_key = ${hashKey(username.toLowerCase())} and ip_key = ${hashKey(xff)}`,
    )
    .limit(1)
  return Number(rows[0]?.c ?? 0)
}

describe("登录限流（admin_login_attempts 服务端执行）", () => {
  it("1. 同一用户名+IP 连续 5 次错误密码 → 前 5 次均 401（未触发）", async () => {
    const xff = "198.51.100.1"
    const results = []
    for (let i = 0; i < 5; i++) {
      const res = await failLogin("rl_admin", xff)
      results.push(res.status)
    }
    expect(results).toEqual([401, 401, 401, 401, 401])
  })

  it("2. 第 6 次 → 429 + Retry-After，且不再新增失败记录（不拖长窗口）", async () => {
    const xff = "198.51.100.1"
    const before = await countFailures("rl_admin", xff)
    const res = await failLogin("rl_admin", xff)
    expect(res.status).toBe(429)
    const retryAfter = Number(res.headers.get("retry-after") ?? "0")
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe("RATE_LIMITED")
    const after = await countFailures("rl_admin", xff)
    expect(after).toBe(before) // 429 请求不记录新失败
  })

  it("3. 同一 IP 用多个不同用户名（每个 < 5 次）累计 20 次失败 → 第 21 次 429（IP 聚合维度）", async () => {
    const xff = "198.51.100.2"
    // 20 个不同用户名各失败 1 次（每用户名维度 = 1，未达 5；IP 维度累计 20）
    for (let i = 0; i < 20; i++) {
      const res = await failLogin(`ipflood_${i}_u`, xff)
      expect(res.status, `request ${i + 1}`).toBe(401)
    }
    const res21 = await failLogin("ipflood_last_u", xff)
    expect(res21.status).toBe(429)
    expect(Number(res21.headers.get("retry-after") ?? "0")).toBeGreaterThanOrEqual(1)
  })

  it("4. 限流窗口结束后恢复（历史失败滑出 15 分钟窗口 → 可再次尝试）", async () => {
    const xff = "198.51.100.1" // 复用用例 1/2 的已限流 IP
    const { hashKey } = await import("../../src/lib/admin/auth/login.ts")
    // 将该 IP 的全部失败记录回拨到 16 分钟前（模拟窗口过期；直接改库）
    await env.db
      .update(adminLoginAttempts)
      .set({ attemptedAt: addSecondsString(utcNowString(), -16 * 60) })
      .where(sql`ip_key = ${hashKey(xff)}`)

    const res = await failLogin("rl_admin", xff)
    expect(res.status).toBe(401) // 已恢复允许尝试（仍是错误密码 → 401 而非 429）
  })

  it("5. 登录成功记录成功事件，且成功不计入限流（同用户名 5 次失败前有一次成功 → 仍可继续失败尝试）", async () => {
    const xff = "198.51.100.3"
    // 先成功一次（正确密码）
    const ok = await loginRoute.POST(
      adminReq({
        method: "POST",
        path: LOGIN_PATH,
        body: { username: "rl_admin", password: "Rl-Pass-123456" },
        xff,
        origin: "http://admin.test",
      }),
    )
    expect(ok.status).toBe(200)
    // 再失败 5 次 —— 成功事件不占失败额度
    for (let i = 0; i < 5; i++) {
      const res = await failLogin("rl_admin", xff)
      expect(res.status, `failure ${i + 1}`).toBe(401)
    }
    const { hashKey } = await import("../../src/lib/admin/auth/login.ts")
    const succ = await env.db
      .select({ c: sql<number>`count(*)` })
      .from(adminLoginAttempts)
      .where(sql`succeeded = 1 and username_key = ${hashKey("rl_admin")} and ip_key = ${hashKey(xff)}`)
      .limit(1)
    expect(Number(succ[0]?.c ?? 0)).toBe(1) // 成功事件留痕
  })

  it("6. 不存在的账号同样受用户名+IP 限流（防枚举扫描），错误文案与真实账号一致", async () => {
    const xff = "198.51.100.4"
    for (let i = 0; i < 5; i++) {
      const res = await failLogin("ghost_zzz", xff)
      expect(res.status).toBe(401)
      const j = (await res.json()) as { error: { message: string } }
      expect(j.error.message).toBe("用户名或密码错误")
    }
    const res = await failLogin("ghost_zzz", xff)
    expect(res.status).toBe(429) // 第 6 次被限
  })

  it("7. 过期记录清理（24h 前的记录在下次登录时被清除）", async () => {
    const xff = "198.51.100.5"
    // 制造一批 25 小时前的旧失败记录
    const { hashKey } = await import("../../src/lib/admin/auth/login.ts")
    const old = addSecondsString(utcNowString(), -25 * 3600)
    await env.db.insert(adminLoginAttempts).values(
      [0, 1, 2].map(() => ({
        usernameKey: hashKey("cleanup_u"),
        ipKey: hashKey(xff),
        attemptedAt: old,
        succeeded: false,
      })),
    )
    expect(await countFailures("cleanup_u", xff)).toBe(3)
    // 触发一次登录（失败）→ 服务端随之执行清理（登录尝试后同步 await）
    const res = await failLogin("rl_admin", xff)
    expect(res.status).toBe(401)
    // 清理是随响应完成的；再留一拍兜底异步余量
    await new Promise((r) => setTimeout(r, 50))
    expect(await countFailures("cleanup_u", xff)).toBe(0)
  })
})
