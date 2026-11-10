// P3 测试共享辅助（scratch 库 facai8_p3_test，与 P2 的 facai8_p2_test 隔离）
// - pointAppAtScratch()：把应用侧 client.ts 池指向 scratch 库（必须在文件内首次 getDrizzle 前调用）
// - createTestAdmin()：直接入库的测试管理员（Argon2id + 角色关联）
// - adminReq()：构造调用后台 API 的 Request（Cookie/Origin/CSRF/XFF 可控）
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/mysql2"
import type { Pool } from "mysql2/promise"
import * as schema from "../../src/lib/db/schema"
import { adminRoles, adminUserRoles, adminUsers } from "../../src/lib/db/schema"
import type { AdminDb } from "../../src/lib/db/client"
import { hashPassword } from "../../src/lib/admin/auth/password.ts"
import { hashSessionToken } from "../../src/lib/admin/auth/session.ts"
import { dropScratch, freshMigratedPool, makeDb, readCreds } from "./test-db"
import { runSeedRbac } from "../../scripts/admin/seed-rbac"
export const P3_SCRATCH = "facai8_p3_test"
export const P3_CSRF_SECRET = "p3-test-csrf-secret-0123456789abcdef0123456789"

/** 测试基址（Request 仅用其 header；origin 比较基于 Origin/Host 头） */
export const BASE_ORIGIN = "http://admin.test"
export const TEST_HOST = "admin.test"
/** 缺省测试客户端 IP（模拟 Nginx 按 $remote_addr 覆盖后的 XFF 最左侧值） */
export const DEFAULT_XFF = "203.0.113.7"

/** 将应用侧连接池指向 scratch 库（vitest isolate=true：每测试文件模块注册表独立） */
export function pointAppAtScratch(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P3_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P3_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export function resetAppEnv(): void {
  delete process.env.DB_PASSWORD
  delete process.env.ADMIN_CSRF_SECRET
  delete process.env.ADMIN_SESSION_TTL_HOURS
}

/** 切换 NODE_ENV（@types/node 将 NODE_ENV 标为只读，测试需要临时切换 → 转 Record 写） */
export function setNodeEnv(value: string | undefined): void {
  const e = process.env as Record<string, string | undefined>
  if (value === undefined) delete e.NODE_ENV
  else e.NODE_ENV = value
}

/**
 * 带完整 schema 的 Drizzle 实例（与 src/lib/db/client.ts 的 getDrizzle() 同型：AdminDb）。
 * 传入 scratch 池后，可直接喂给 src/lib/admin 下带默认 getDrizzle() 参数的服务/原语函数
 * （依赖注入，确保应用代码操作的是 scratch 库）。
 */
export function makeAppDb(pool: Pool): AdminDb {
  return drizzle(pool, { schema, mode: "default" })
}

/** P3 套件环境：scratch 库（建库+迁移+RBAC seed）+ 指向 scratch 的应用池 env */
export interface P3Env {
  pool: Pool
  db: AdminDb
}

export async function setupP3Env(): Promise<P3Env> {
  pointAppAtScratch()
  const pool = await freshMigratedPool(P3_SCRATCH)
  // seed 走 P2 的无 schema 工厂（runSeedRbac 的参数类型是 Record<string,never>）
  await runSeedRbac(makeDb(pool)) // 幂等：42 权限 / 4 角色 / 108 映射
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP3Env(env: P3Env): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P3_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface TestAdmin {
  id: bigint
  username: string
  password: string
}

export interface CreateAdminOpts {
  username: string
  password?: string
  roles?: string[]
  status?: "active" | "disabled" | "locked"
  mustChangePassword?: boolean
  deletedAt?: string | null
}

const randomSuffix = () => Math.random().toString(36).slice(2, 12)

/** 在 scratch 库创建测试管理员（Argon2id；角色按 code 关联；MySQL 无 returning → 唯一键回查） */
export async function createTestAdmin(db: AdminDb, opts: CreateAdminOpts): Promise<TestAdmin> {
  const password = opts.password ?? `Test-Pass-${randomSuffix()}-x`
  const username = opts.username
  await db.insert(adminUsers).values({
    username,
    email: `${username.toLowerCase()}@p3test.local`,
    passwordHash: await hashPassword(password),
    displayName: `${username}（测试）`,
    status: opts.status ?? "active",
    mustChangePassword: opts.mustChangePassword ?? false,
    deletedAt: opts.deletedAt ?? null,
  })
  const rows = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, username)).limit(1)
  const id = rows[0]?.id
  if (!id) throw new Error(`createTestAdmin: user not found after insert: ${username}`)

  for (const code of opts.roles ?? ["super_admin"]) {
    const roleRows = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.code, code)).limit(1)
    const roleId = roleRows[0]?.id
    if (!roleId) throw new Error(`createTestAdmin: role not seeded: ${code}`)
    await db.insert(adminUserRoles).values({ userId: id, roleId })
  }
  return { id, username, password }
}

export interface AdminReqOpts {
  method?: string
  path: string
  /** JSON 请求体（默认 Content-Type: application/json） */
  body?: unknown
  contentType?: string | null
  /** 原始 Cookie 头（如 `facai8_admin_session=<token>`；可拼接多个） */
  cookie?: string
  /** Origin 头（缺省 = 同源 BASE_ORIGIN） */
  origin?: string | null
  /** Host 头（缺省 TEST_HOST） */
  host?: string
  /** X-CSRF-Token */
  csrf?: string
  /** X-Forwarded-For（缺省 = 固定的测试客户端 IP） */
  xff?: string
  userAgent?: string
}

/** 构造调用后台 API 的 Request（直接驱动 route handler，无需起服务） */
export function adminReq(opts: AdminReqOpts): Request {
  const headers = new Headers()
  const bodyText = opts.body === undefined ? undefined : JSON.stringify(opts.body)
  if (bodyText !== undefined) {
    headers.set("content-type", opts.contentType ?? "application/json")
  } else if (opts.contentType) {
    headers.set("content-type", opts.contentType)
  }
  if (opts.cookie) headers.set("cookie", opts.cookie)
  headers.set("origin", opts.origin ?? BASE_ORIGIN)
  headers.set("host", opts.host ?? TEST_HOST)
  if (opts.csrf) headers.set("x-csrf-token", opts.csrf)
  headers.set("x-forwarded-for", opts.xff ?? DEFAULT_XFF)
  if (opts.userAgent) headers.set("user-agent", opts.userAgent)
  return new Request(BASE_ORIGIN + opts.path, {
    method: opts.method ?? "GET",
    headers,
    body: bodyText,
  })
}

/** 从 Set-Cookie 响应头提取管理员 token（测试断言用；非空才算登录成功） */
export function cookieToken(res: Response): string | null {
  const sc = res.headers.get("set-cookie")
  if (!sc) return null
  const first = sc.split(";")[0] ?? ""
  const eqIdx = first.indexOf("=")
  if (eqIdx < 0) return null
  const name = first.slice(0, eqIdx).trim()
  const value = first.slice(eqIdx + 1).trim()
  return name === "facai8_admin_session" && value.length > 0 ? value : null
}

/** 拼接携带 admin session 的 Cookie 头（可附加前台 cookie 做冒充测试） */
export function adminCookie(token: string, extra?: string): string {
  const base = `facai8_admin_session=${token}`
  return extra ? `${base}; ${extra}` : base
}

/** 伪造前台 Mock 会话 Cookie（Base64 形态，与前台 auth.ts 同形 —— 用于冒充测试） */
export function forgedFrontendSession(username = "hackers"): string {
  const payload = JSON.stringify({ u: username, a: null, s: "forged" })
  return `facai8_session=${Buffer.from(payload).toString("base64url")}`
}

export { hashSessionToken }
