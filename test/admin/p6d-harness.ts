// P6D 测试共享辅助（scratch 库 facai8_p6d_test，与 P2–P6C 套件隔离）
// - 与 p6c-harness 同构：建库 + 全部迁移（含 0005 ads/lines AUTO_INCREMENT + settings.version）+ RBAC seed + 登录
// - 额外提供 ad/line/site_setting 直插辅助（构造历史雪花 ID、软删除、legacy 双重编码值等非 API 可达场景）
import type { Pool } from "mysql2/promise"
import { sql } from "drizzle-orm"
import { ads, siteLines, siteSettings } from "../../src/lib/db/schema"
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
import type { AdDbStatus } from "../../src/lib/admin/dto/ad.ts"
import type { LineStatus } from "../../src/lib/admin/dto/line.ts"

export const P6D_SCRATCH = "facai8_p6d_test"
export const P6D_CSRF_SECRET = "p6d-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧连接池指向 P6D scratch 库（必须在文件内首次 getDrizzle 前调用） */
export function pointAppAtP6d(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P6D_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P6D_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export interface P6dEnv {
  pool: Pool
  db: AdminDb
}

export async function setupP6dEnv(): Promise<P6dEnv> {
  pointAppAtP6d()
  const pool = await freshMigratedPool(P6D_SCRATCH)
  await runSeedRbac(makeDb(pool))
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP6dEnv(env: P6dEnv): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P6D_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export interface P6dSession {
  admin: TestAdmin
  token: string
  csrf: string
  cookie: string
}

const P6D_PASSWORD = "P6d-Pass-12345"

/** 创建指定角色的测试管理员并完成真实登录（cookie + csrf 全部走生产路径） */
export async function p6dLogin(env: P6dEnv, username: string, roles: string[]): Promise<P6dSession> {
  const admin = await createTestAdmin(env.db, { username, roles, password: P6D_PASSWORD })
  const loginRoute = await import("../../src/app/api/admin/v1/auth/login/route")
  const res = await loginRoute.POST(
    adminReq({ method: "POST", path: "/api/admin/v1/auth/login", body: { username, password: P6D_PASSWORD } }),
  )
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`p6dLogin failed (${res.status}): ${text}`)
  }
  const raw = res.headers.get("set-cookie") ?? ""
  const token = /facai8_admin_session=([^;]+)/.exec(raw)?.[1] ?? ""
  if (!token) throw new Error("p6dLogin: session cookie missing")
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
  session: P6dSession,
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

/** 直插广告（走 AUTO_INCREMENT）；可构造历史 position / 软删除 / 排期字段等 API 外形态 */
export async function seedAdRaw(
  db: AdminDb,
  opts: {
    title?: string
    position?: string
    targetUrl?: string
    imagePath?: string
    status?: AdDbStatus
    sortOrder?: number
    startsAt?: string | null
    endsAt?: string | null
    deleted?: boolean
  },
): Promise<string> {
  await db
    .insert(ads)
    .values({
      title: opts.title ?? "p6d-seed-ad",
      position: opts.position ?? "home",
      targetUrl: opts.targetUrl ?? "https://example.com/land",
      imagePath: opts.imagePath ?? "/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png",
      status: opts.status ?? "draft",
      sortOrder: opts.sortOrder ?? 0,
      startsAt: opts.startsAt ?? null,
      endsAt: opts.endsAt ?? null,
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

/** 直插线路（走 AUTO_INCREMENT） */
export async function seedLineRaw(
  db: AdminDb,
  opts: {
    name?: string
    url?: string
    status?: LineStatus
    sortOrder?: number
    deleted?: boolean
  },
): Promise<string> {
  await db
    .insert(siteLines)
    .values({
      name: opts.name ?? "p6d-seed-line",
      url: opts.url ?? "https://example.com/line",
      status: opts.status ?? "disabled",
      sortOrder: opts.sortOrder ?? 0,
      deletedAt: opts.deleted ? "2026-01-01 00:00:00.000" : null,
    })
    .execute()
  const rows = await db.execute(sql`SELECT LAST_INSERT_ID() AS id`)
  const first = (rows as unknown as [Array<{ id: string }>, unknown])[0][0]
  return String(first.id)
}

/** 直插/覆写 site_settings 行（settingValue 原样入 JSON 列 → 传字符串即 legacy 双重编码形态） */
export async function seedSettingRaw(
  db: AdminDb,
  key: string,
  settingValue: unknown,
  version?: number,
): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ settingKey: key, settingValue, version: version ?? 1 })
    .onDuplicateKeyUpdate({ set: { settingValue, version: version ?? 1 } })
    .execute()
}

export { BASE_ORIGIN, adminCookie, adminReq, createTestAdmin, forgedFrontendSession, resetAppEnv, setNodeEnv }
export type { CreateAdminOpts, TestAdmin }
