// P5 测试共享辅助（scratch 库 facai8_p5_test，与 P2/P3/P4 套件隔离）
// - 复用 P3 的通用构造器（createTestAdmin / adminReq / cookieToken / adminCookie）
// - setupP5Env：建库 + 迁移 + RBAC seed（46 权限 / 4 角色 / 120 映射，P6A 后）
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, makeDb, readCreds } from "./test-db"
import { runSeedRbac } from "../../scripts/admin/seed-rbac"
import { hashSessionToken } from "../../src/lib/admin/auth/session.ts"
import {
  adminCookie,
  adminReq,
  cookieToken,
  createTestAdmin,
  forgedFrontendSession,
  resetAppEnv,
  setNodeEnv,
  type AdminReqOpts,
  type CreateAdminOpts,
  type TestAdmin,
} from "./test-admin"
import type { AdminDb } from "../../src/lib/db/client"
import { makeAppDb } from "./test-admin"

export const P5_SCRATCH = "facai8_p5_test"
export const P5_CSRF_SECRET = "p5-test-csrf-secret-0123456789abcdef0123456789"

/** 把应用侧连接池指向 P5 scratch 库（必须在文件内首次 getDrizzle 前调用） */
export function pointAppAtP5(): void {
  const c = readCreds()
  process.env.DB_HOST = c.host
  process.env.DB_PORT = String(c.port)
  process.env.DB_NAME = P5_SCRATCH
  process.env.DB_USER = c.user
  process.env.DB_PASSWORD = c.password
  process.env.DB_POOL_SIZE = "5"
  process.env.ADMIN_CSRF_SECRET = P5_CSRF_SECRET
  process.env.ADMIN_SESSION_TTL_HOURS = "12"
}

export interface P5Env {
  pool: Pool
  db: AdminDb
}

export async function setupP5Env(): Promise<P5Env> {
  pointAppAtP5()
  const pool = await freshMigratedPool(P5_SCRATCH)
  await runSeedRbac(makeDb(pool))
  const db = makeAppDb(pool)
  return { pool, db }
}

export async function teardownP5Env(env: P5Env): Promise<void> {
  const client = await import("../../src/lib/db/client.ts")
  await client.closeDb()
  await dropScratch(P5_SCRATCH)
  await env.pool.end()
  resetAppEnv()
}

export {
  adminCookie,
  adminReq,
  cookieToken,
  createTestAdmin,
  forgedFrontendSession,
  hashSessionToken,
  setNodeEnv,
  type AdminReqOpts,
  type CreateAdminOpts,
  type TestAdmin,
}
