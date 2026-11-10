// P2 测试共享辅助：一次性 scratch 数据库（facai8_p2_test）生命周期 + 迁移执行
// - 凭据运行时解析自 docs/mysql数据库信息.md（该文件被 .gitignore 的 docs/* 规则排除，永不入库）
// - 只允许操作 facai8 前缀库；scratch 库名是常量并带后缀守卫，绝不误伤 soucai8 等无关库
// - 每个测试文件 beforeAll 建库+迁移、afterAll 删库；文件串行（vitest fileParallelism:false）
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import mysql from "mysql2/promise"
import type { Pool } from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import { migrate } from "drizzle-orm/mysql2/migrator"

export const SCRATCH_DB = "facai8_p2_test"

export interface DbCreds {
  host: string
  port: number
  user: string
  password: string
}

export function readCreds(): DbCreds {
  const doc = readFileSync(fileURLToPath(new URL("../../docs/mysql数据库信息.md", import.meta.url)), "utf8")
  const pick = (k: string): string => {
    const m = doc.match(new RegExp('"' + k + '"\\s*:\\s*"?([^"\\s,}]+)'))
    return m ? m[1] : ""
  }
  return {
    host: pick("host") || "127.0.0.1",
    port: Number(pick("port") || 3306),
    user: pick("user_name"),
    password: pick("password"),
  }
}

const poolBase = {
  bigNumberStrings: true,
  supportBigNumbers: true,
  timezone: "Z" as const,
  connectTimeout: 10_000,
}

export function openPool(database?: string, override?: Partial<DbCreds>): Pool {
  const c = { ...readCreds(), ...override }
  return mysql.createPool({
    ...poolBase,
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database,
    connectionLimit: 5,
  })
}

/** 连接（不带 database）以执行库级 DDL */
function openAdminConnection(): Promise<mysql.Connection> {
  const c = readCreds()
  return new Promise((res, rej) => {
    mysql
      .createConnection({ ...poolBase, host: c.host, port: c.port, user: c.user, password: c.password })
      .then(res)
      .catch(rej)
  })
}

/**
 * 建/删 scratch 库（默认 facai8_p2_test；P3 传 "facai8_p3_test" 与 P2 套件隔离）。
 * 守卫：只允许 facai8_ 前缀的合法库名，绝不误伤无关库。
 */
export async function ensureScratch(name: string = SCRATCH_DB): Promise<Pool> {
  assertScratchName(name)
  const admin = await openAdminConnection()
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  await admin.end()
  return openPool(name)
}

function assertScratchName(name: string): void {
  if (!/^[a-z0-9_]{4,64}$/.test(name) || !name.startsWith("facai8_")) {
    throw new Error("refuse to operate on unexpected database name: " + name)
  }
}

/** 只允许删除白名单内的 scratch 库（防误伤） */
export async function dropScratch(name: string = SCRATCH_DB): Promise<void> {
  assertScratchName(name)
  const admin = await openAdminConnection()
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
  await admin.end()
}

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url))

/** 在给定池上执行全部迁移（migrator 幂等：已应用则空操作） */
export async function runMigrations(pool: Pool): Promise<void> {
  const db = drizzle(pool, { mode: "default" })
  await migrate(db, { migrationsFolder })
}

export function makeDb(pool: Pool) {
  return drizzle(pool, { mode: "default" })
}

/** 建 scratch 库并跑完迁移（测试 beforeAll 用；name 缺省 = facai8_p2_test） */
export async function freshMigratedPool(name: string = SCRATCH_DB): Promise<Pool> {
  const pool = await ensureScratch(name)
  await runMigrations(pool)
  return pool
}
