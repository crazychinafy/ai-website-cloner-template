// P6C 测试共享辅助（scratch 库 facai8_p6c_test，与 P2–P6B 套件隔离）
// - 与 p6b-harness 同构：建库 + 全部迁移（含 0004 articles/bulletins AUTO_INCREMENT）+ RBAC seed + 登录
// - 额外提供 article/bulletin 直插辅助（构造软删除/历史脏正文/浏览量等非 API 可达场景）
import type { Pool } from "mysql2/promise"
import { sql } from "drizzle-orm"
import { articles, bulletins } from "../../src/lib/db/schema"
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
import type { ArticleStatus } from "../../src/lib/admin/validation/article-schema.ts"
import type { BulletinStatus } from "../../src/lib/admin/validation/bulletin-schema.ts"

export const P6C_SCRATCH = "facai8_p6c_test"
export const P6C_CSRF_SECRET = "p6c-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧连接池指向 P6C scratch 库（必须在文件内首次 getDrizzle 前调用） */
export function pointAppAtP6c(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P6C_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P6C_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export interface P6cEnv {
  pool: Pool
  db: AdminDb
}

export async function setupP6cEnv(): Promise<P6cEnv> {
  pointAppAtP6c()
  const pool = await freshMigratedPool(P6C_SCRATCH)
  await runSeedRbac(makeDb(pool))
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP6cEnv(env: P6cEnv): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P6C_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface P6cSession {
  admin: TestAdmin
  token: string
  csrf: string
  cookie: string
}

const P6C_PASSWORD = "P6c-Pass-12345"

/** 创建指定角色的测试管理员并完成真实登录（cookie + csrf 全部走生产路径） */
export async function p6cLogin(env: P6cEnv, username: string, roles: string[]): Promise<P6cSession> {
  const admin = await createTestAdmin(env.db, { username, roles, password: P6C_PASSWORD })
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: P6C_PASSWORD } }),
  )
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`p6cLogin failed (${res.status}): ${text}`)
  }
  const raw = res.headers.get("set-cookie") ?? ""
  const token = /facai8_admin_session=([^;]+)/.exec(raw)?.[1] ?? ""
  if (!token) throw new Error("p6cLogin: session cookie missing")
  const sess = await import("../../src/lib/admin/services/admin-auth-service.ts")
  const identity = await sess.getSession(
    adminReq({ path: "/api/admin/v1/auth/session", cookie: `facai8_admin_session=${token}` }),
  )
  return { admin, token, csrf: identity.data.csrfToken, cookie: adminCookie(token) }
}

/** createTestAdmin 的 displayName 规则（authorName 断言用） */
export function expectedAuthorName(username: string): string {
  return `${username}（测试）`
}

export interface ReqForOpts extends Omit<AdminReqOpts, "method" | "path" | "cookie" | "csrf"> {
  noAuth?: boolean
  noCsrf?: boolean
  csrfOverride?: string
}

/** 构造带会话凭据的后台 API Request */
export function reqFor(
  session: P6cSession,
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

// ── 原始 SQL 辅助 ────────────────────────────────────────────────

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

export async function countAudit(pool: Pool, action: string): Promise<number> {
  const rows = await rawQuery<{ n: number | string }>(pool, "SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = ?", [action])
  return Number(rows[0]!.n)
}

/** 直插文章（走 AUTO_INCREMENT——与 API 新建同一条 ID 流）；contentHtml 原样入库（模拟历史脏正文） */
export async function seedArticleRaw(
  db: AdminDb,
  opts: {
    categoryId: string
    title?: string
    contentHtml?: string
    status?: ArticleStatus
    deleted?: boolean
    viewCount?: number
    publishedAt?: string | null
    authorName?: string
    categoryNameSnapshot?: string
  },
): Promise<string> {
  await db
    .insert(articles)
    .values({
      categoryId: BigInt(opts.categoryId),
      title: opts.title ?? "p6c-seed-article",
      contentHtml: opts.contentHtml ?? "<p>seed body</p>",
      categoryNameSnapshot: opts.categoryNameSnapshot ?? "",
      authorName: opts.authorName ?? "seed作者",
      status: opts.status ?? "draft",
      viewCount: BigInt(opts.viewCount ?? 0),
      publishedAt: opts.publishedAt ?? (opts.status === "published" ? "2026-01-02 03:04:05.000" : null),
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

/** 直插公告（走 AUTO_INCREMENT）；sortOrder 显式指定（构造并列排序值的默认排序场景） */
export async function seedBulletinRaw(
  db: AdminDb,
  opts: {
    title?: string
    contentHtml?: string
    status?: BulletinStatus
    sortOrder?: number
    deleted?: boolean
    publishedAt?: string | null
  },
): Promise<string> {
  await db
    .insert(bulletins)
    .values({
      title: opts.title ?? "p6c-seed-bulletin",
      contentHtml: opts.contentHtml ?? "<p>seed body</p>",
      status: opts.status ?? "draft",
      sortOrder: opts.sortOrder ?? 0,
      publishedAt: opts.publishedAt ?? (opts.status === "published" ? "2026-01-02 03:04:05.000" : null),
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

export { BASE_ORIGIN, adminCookie, adminReq, createTestAdmin, forgedFrontendSession, resetAppEnv, setNodeEnv }
export type { CreateAdminOpts, TestAdmin }
