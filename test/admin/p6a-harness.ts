// P6A 测试共享辅助（scratch 库 facai8_p6a_test，与 P2–P5 套件隔离）
// - setupP6aEnv：建库 + 0000/0001 迁移 + RBAC seed（46 权限 / 4 角色）
// - p6aLogin：createTestAdmin → 登录路由 → 会话服务取 csrf，返回 cookie+csrf 会话凭据
// - reqFor：注入 cookie/csrf 的 adminReq 包装（可关闭 CSRF 做负例）
// - 直接调用 route 模块（Next 16 handler 形态），信封断言用 envelope()
import type { Pool } from "mysql2/promise"
import { articles, siteLinks } from "../../src/lib/db/schema"
import { dropScratch, freshMigratedPool, makeDb, readCreds } from "./test-db"
import { runSeedRbac } from "../../scripts/admin/seed-rbac"
import {
  adminCookie,
  adminReq,
  createTestAdmin,
  forgedFrontendSession,
  resetAppEnv,
  setNodeEnv,
  BASE_ORIGIN,
  type AdminReqOpts,
  type CreateAdminOpts,
  type TestAdmin,
} from "./test-admin"
import { makeAppDb } from "./test-admin"
import type { AdminDb } from "../../src/lib/db/client"

export const P6A_SCRATCH = "facai8_p6a_test"
export const P6A_CSRF_SECRET = "p6a-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧连接池指向 P6A scratch 库（必须在文件内首次 getDrizzle 前调用） */
export function pointAppAtP6a(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P6A_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P6A_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export interface P6aEnv {
  pool: Pool
  db: AdminDb
}

export async function setupP6aEnv(): Promise<P6aEnv> {
  pointAppAtP6a()
  const pool = await freshMigratedPool(P6A_SCRATCH)
  await runSeedRbac(makeDb(pool))
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP6aEnv(env: P6aEnv): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P6A_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface P6aSession {
  admin: TestAdmin
  token: string
  csrf: string
  cookie: string
}

const P6A_PASSWORD = "P6a-Pass-12345"

/** 创建指定角色的测试管理员并完成真实登录（cookie + csrf 全部走生产路径） */
export async function p6aLogin(env: P6aEnv, username: string, roles: string[]): Promise<P6aSession> {
  const admin = await createTestAdmin(env.db, { username, roles, password: P6A_PASSWORD })
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: P6A_PASSWORD } }),
  )
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`p6aLogin failed (${res.status}): ${text}`)
  }
  const raw = res.headers.get("set-cookie") ?? ""
  const token = /facai8_admin_session=([^;]+)/.exec(raw)?.[1] ?? ""
  if (!token) throw new Error("p6aLogin: session cookie missing")
  const sess = await import("../../src/lib/admin/services/admin-auth-service.ts")
  const identity = await sess.getSession(
    adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` }),
  )
  return { admin, token, csrf: identity.data.csrfToken, cookie: adminCookie(token) }
}

export interface ReqForOpts extends Omit<AdminReqOpts, "method" | "path" | "cookie" | "csrf"> {
  /** 默认注入会话 cookie 与 csrf；noAuth=true 时两者都不带（401 负例） */
  noAuth?: boolean
  /** 带 cookie 但故意不带 X-CSRF-Token（CSRF 负例） */
  noCsrf?: boolean
  /** 覆盖 csrf 值 */
  csrfOverride?: string
}

/** 构造带会话凭据的后台 API Request（method+path 必填，其余透传 adminReq） */
export function reqFor(
  session: P6aSession,
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

/** 解析失败信封 */
export async function errBody(res: Response): Promise<ErrorEnvelope> {
  return (await res.json()) as ErrorEnvelope
}

// ── 原始 SQL 辅助（引用计数 / 审计行 / AUTO_INCREMENT 探测）──

export async function rawQuery<T = Record<string, unknown>>(pool: Pool, query: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await pool.query(query, params)
  return rows as T[]
}

export interface AuditRow {
  actor_user_id: string
  action: string
  resource_type: string
  resource_id: string
  before_json: unknown
  after_json: unknown
  request_id: string
}

/** 审计 JSON 列（MySQL JSON 类型 → mysql2 已解析为对象；兼容字符串形态） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function auditJson(value: unknown): any {
  if (typeof value === "string") return JSON.parse(value)
  return value
}

export function auditRows(pool: Pool, action: string): Promise<AuditRow[]> {
  return rawQuery<AuditRow>(
    pool,
    "SELECT actor_user_id, action, resource_type, resource_id, before_json, after_json, request_id " +
      "FROM admin_audit_logs WHERE action = ? ORDER BY id",
    [action],
  )
}

/** 雪花风格测试主键（19 位，唯一，BIGINT UNSIGNED 范围内） */
let linkSeq = 0
export function testBigIntId(): string {
  linkSeq += 1
  return (BigInt("8800000000000000000") + BigInt(linkSeq)).toString()
}

export interface SeedLinkOpts {
  categoryId: string
  tagId?: string | null
  title?: string
  deleted?: boolean
}

/** 直插一条网址（绕过 Service，用于构造“分类/标签被引用”场景；含软删除变体） */
export async function seedLink(db: AdminDb, opts: SeedLinkOpts): Promise<string> {
  const id = testBigIntId()
  await db
    .insert(siteLinks)
    .values({
      id: BigInt(id),
      categoryId: BigInt(opts.categoryId),
      tagId: opts.tagId ? BigInt(opts.tagId) : null,
      title: opts.title ?? "p6a-seed-link",
      url: "https://example.com/p6a",
      description: "",
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  return id
}

export interface SeedArticleOpts {
  categoryId: string
  title?: string
  deleted?: boolean
}

/** 直插一篇文章（用于“文章分类被引用”场景） */
export async function seedArticle(db: AdminDb, opts: SeedArticleOpts): Promise<string> {
  const id = testBigIntId()
  await db
    .insert(articles)
    .values({
      id: BigInt(id),
      categoryId: BigInt(opts.categoryId),
      title: opts.title ?? "p6a-seed-article",
      contentHtml: "<p>p6a</p>",
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  return id
}

export { BASE_ORIGIN, adminCookie, adminReq, createTestAdmin, forgedFrontendSession, resetAppEnv, setNodeEnv }
export type { CreateAdminOpts, TestAdmin }
