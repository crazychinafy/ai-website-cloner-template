// P7 测试共享辅助（scratch 库 facai8_p7_test，与 P2–P6D 套件隔离）
// - 与 p6d-harness 同构：建库 + 全部迁移 + RBAC seed + 真实登录（cookie/csrf 走生产路径）
// - 额外提供：rawQuery / countRows / auditRows 直读辅助（审计与导入历史行断言）
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, makeDb, readCreds } from "./test-db"
import { runSeedRbac } from "../../scripts/admin/seed-rbac"
import {
  adminCookie,
  adminReq,
  createTestAdmin,
  resetAppEnv,
  BASE_ORIGIN,
  type AdminReqOpts,
  type TestAdmin,
} from "./test-admin"
import { makeAppDb } from "./test-admin"
import type { AdminDb } from "../../src/lib/db/client"

export const P7_SCRATCH = "facai8_p7_test"
export const P7_CSRF_SECRET = "p7-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧池 + 导入核心（getAdminEnv）全部指向 scratch 库（模块首次 getDrizzle 前调用） */
export function pointAppAtP7(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P7_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P7_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
  delete process.env.ADMIN_IMPORT_ALLOW_PRODUCTION
}

export interface P7Env {
  pool: Pool
  db: AdminDb
}

export async function setupP7Env(): Promise<P7Env> {
  pointAppAtP7()
  const pool = await freshMigratedPool(P7_SCRATCH)
  await runSeedRbac(makeDb(pool)) // 幂等：46 权限 / 4 角色 / 120+ 映射
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP7Env(env: P7Env): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P7_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface P7Session {
  admin: TestAdmin
  token: string
  csrf: string
  cookie: string
}

const P7_PASSWORD = "P7-T3st-Pass-98765"

/** 创建指定角色的测试管理员并完成真实登录 */
export async function p7Login(env: P7Env, username: string, roles: string[]): Promise<P7Session> {
  const admin = await createTestAdmin(env.db, { username, roles, password: P7_PASSWORD })
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route.ts")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: P7_PASSWORD } }),
  )
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`p7Login failed (${res.status}): ${text}`)
  }
  const raw = res.headers.get("set-cookie") ?? ""
  const token = /facai8_admin_session=([^;]+)/.exec(raw)?.[1] ?? ""
  if (!token) throw new Error("p7Login: session cookie missing")
  const sess = await import("../../src/lib/admin/services/admin-auth-service.ts")
  const identity = await sess.getSession(
    adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` }),
  )
  return { admin, token, csrf: identity.data.csrfToken, cookie: adminCookie(token) }
}

export interface ReqForOpts extends Omit<AdminReqOpts, "method" | "path" | "cookie" | "csrf"> {
  noAuth?: boolean
  noCsrf?: boolean
  csrfOverride?: string
}

/** 构造带会话凭据的后台 API Request */
export function reqFor(
  session: P7Session,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  opts: ReqForOpts = {},
): Request {
  const { noAuth, noCsrf, csrfOverride, ...rest } = opts
  return adminReq({
    method,
    path,
    ...(body !== undefined ? { body } : {}),
    ...(noAuth ? {} : { cookie: `facai8_admin_session=${session.token}` }),
    ...(!noAuth && !noCsrf ? { csrf: csrfOverride ?? session.csrf } : {}),
    ...rest,
  })
}

export interface ErrorEnvelope {
  success: false
  error: { code: string; message: string; fields?: Record<string, string> }
  requestId?: string
}

export async function errBody(res: Response): Promise<ErrorEnvelope> {
  return (await res.json()) as ErrorEnvelope
}

export interface OkEnvelope<T> {
  success: true
  data: T
  requestId?: string
}

export async function okBody<T = unknown>(res: Response): Promise<OkEnvelope<T>> {
  return (await res.json()) as OkEnvelope<T>
}

// ── 原始 SQL 辅助 ────────────────────────────────────────────────

export async function rawQuery<T = Record<string, unknown>>(pool: Pool, query: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await pool.query(query, params)
  return rows as T[]
}

export async function countRows(pool: Pool, table: string, where = ""): Promise<number> {
  const rows = await rawQuery<{ n: number | string }>(pool, `select count(*) as n from \`${table}\`${where ? ` ${where}` : ""}`)
  return Number(rows[0]?.n ?? 0)
}

export interface AuditRawRow {
  id: string
  actor_user_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  before_json: unknown
  after_json: unknown
  request_id: string | null
  user_agent: string | null
}

/** 直读 admin_audit_logs（绕过应用层；断言落库内容本身，含脱敏结果） */
export async function auditRows(
  pool: Pool,
  where = "",
  params: unknown[] = [],
): Promise<AuditRawRow[]> {
  return rawQuery<AuditRawRow>(
    pool,
    `select id, actor_user_id, action, resource_type, resource_id, before_json, after_json, request_id, user_agent
       from admin_audit_logs${where ? ` ${where}` : ""} order by id`,
    params,
  )
}

/** json 列可能回传字符串或已解析对象（两种形态统一解析） */
export function parseJsonCol(v: unknown): unknown {
  if (typeof v === "string") {
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  return v
}

export { BASE_ORIGIN }
