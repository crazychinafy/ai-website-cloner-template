// P8 测试共享辅助：一次性 scratch 库 facai8_p8_unit_test（beforeAll 建 / afterAll 删，与 P2-P7 套件互不干扰）。
// 注意：与 dual-render 长期验证库 facai8_p8_test（导入器灌数、next start 只读消费）刻意分开命名，
// 否则本套件 afterAll 的 dropScratch 会连带删掉验证库（2026-11-12 实测踩坑）。
import type { Pool } from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import type { MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../../src/lib/db/schema/index.ts"
import { dropScratch, freshMigratedPool, readCreds } from "./test-db"
import { runStaticImport, type ImportCreds, type ImportResult } from "../../scripts/admin/import-static-snapshot"
import { MySqlRepository } from "../../src/lib/facai8/content/mysql-repository"

export const P8_SCRATCH = "facai8_p8_unit_test"

export function p8Creds(): ImportCreds {
  const c = readCreds()
  return { host: c.host, port: c.port, database: P8_SCRATCH, user: c.user, password: c.password, poolSize: 5 }
}

/** 建 scratch 库 + 全量迁移（beforeAll 用）。先删后建：任何前序套件崩溃残留都不得污染导入守卫判定 */
export async function setupP8Scratch(): Promise<Pool> {
  await dropScratch(P8_SCRATCH)
  return freshMigratedPool(P8_SCRATCH)
}

/** 删 scratch 库（afterAll 用；传入的池需已 end） */
export async function teardownP8Scratch(pool: Pool): Promise<void> {
  await pool.end()
  await dropScratch(P8_SCRATCH)
}

/** 向 scratch 执行一次正式导入（库名确认 = scratch） */
export async function importP8Snapshot(version: string): Promise<ImportResult> {
  return runStaticImport(p8Creds(), { snapshotVersion: version, execute: true, confirmDatabase: P8_SCRATCH })
}

/** 用 scratch 池构造 MySqlRepository（drizzle 实例类型 cast 与 p4/p6 套件一致） */
export function p8MysqlRepo(pool: Pool): MySqlRepository {
  return new MySqlRepository(drizzle(pool, { schema, mode: "default" }) as unknown as MySql2Database<typeof schema>)
}
