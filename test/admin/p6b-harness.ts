// P6B 测试共享辅助（scratch 库 facai8_p6b_test，与 P2–P6A 套件隔离）
// - 与 p6a-harness 同构：建库 + 全部迁移（含 0003 AUTO_INCREMENT）+ RBAC seed + 登录
// - 额外提供 detail/mirror 直插辅助（构造「已有详情/备用链接」的编辑场景）
import type { Pool } from "mysql2/promise"
import { sql } from "drizzle-orm"
import { siteLinkDetails, siteLinkMirrors, siteLinks } from "../../src/lib/db/schema"
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

export const P6B_SCRATCH = "facai8_p6b_test"
export const P6B_CSRF_SECRET = "p6b-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧连接池指向 P6B scratch 库（必须在文件内首次 getDrizzle 前调用） */
export function pointAppAtP6b(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P6B_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P6B_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export interface P6bEnv {
  pool: Pool
  db: AdminDb
}

export async function setupP6bEnv(): Promise<P6bEnv> {
  pointAppAtP6b()
  const pool = await freshMigratedPool(P6B_SCRATCH)
  await runSeedRbac(makeDb(pool))
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP6bEnv(env: P6bEnv): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P6B_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface P6bSession {
  admin: TestAdmin
  token: string
  csrf: string
  cookie: string
}

const P6B_PASSWORD = "P6b-Pass-12345"

/** 创建指定角色的测试管理员并完成真实登录（cookie + csrf 全部走生产路径） */
export async function p6bLogin(env: P6bEnv, username: string, roles: string[]): Promise<P6bSession> {
  const admin = await createTestAdmin(env.db, { username, roles, password: P6B_PASSWORD })
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: P6B_PASSWORD } }),
  )
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`p6bLogin failed (${res.status}): ${text}`)
  }
  const raw = res.headers.get("set-cookie") ?? ""
  const token = /facai8_admin_session=([^;]+)/.exec(raw)?.[1] ?? ""
  if (!token) throw new Error("p6bLogin: session cookie missing")
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
  session: P6bSession,
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

/** 雪花风格测试主键（19 位，唯一）——raw SQL 直插分类/标签时模拟快照显式 ID */
let seq = 0
export function testBigIntId(): string {
  seq += 1
  return (BigInt("8800000000000000000") + BigInt(seq)).toString()
}

/** 直插一条网址（走 AUTO_INCREMENT——与 API 新建同一条 ID 流，避免显式大 ID 竞态） */
export async function seedLinkRaw(
  db: AdminDb,
  opts: { categoryId: string; tagId?: string | null; title?: string; url?: string; status?: "draft" | "published" | "disabled"; deleted?: boolean },
): Promise<string> {
  await db
    .insert(siteLinks)
    .values({
      categoryId: BigInt(opts.categoryId),
      tagId: opts.tagId ? BigInt(opts.tagId) : null,
      title: opts.title ?? "p6b-seed-link",
      url: opts.url ?? "https://example.com/p6b",
      description: "",
      status: opts.status ?? "published",
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

/** 直插详情行（1:1） */
export async function seedDetail(db: AdminDb, linkId: string, extra: { clickCount?: number; detailHtml?: string; annotation?: string } = {}): Promise<void> {
  await db
    .insert(siteLinkDetails)
    .values({
      linkId: BigInt(linkId),
      clickCount: BigInt(extra.clickCount ?? 5),
      detailHtml: extra.detailHtml ?? "<p>seed detail</p>",
      annotation: extra.annotation ?? "",
    })
    .execute()
}

/** 直插备用链接，返回生成的 ID（LAST_INSERT_ID 走原始 SQL，BIGINT 精确） */
export async function seedMirror(db: AdminDb, linkId: string, name: string, url: string, sortOrder = 0): Promise<string> {
  await db
    .insert(siteLinkMirrors)
    .values({ linkId: BigInt(linkId), name, url, sortOrder })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

export { BASE_ORIGIN, adminCookie, adminReq, createTestAdmin, forgedFrontendSession, resetAppEnv, setNodeEnv }
export type { CreateAdminOpts, TestAdmin }
