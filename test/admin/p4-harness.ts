// P4 测试共享辅助：scratch 库 facai8_p4_test（与 P2/P3 套件隔离）+ 导入执行封装
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, readCreds } from "./test-db"
import { runStaticImport, type ImportCreds, type ImportResult } from "../../scripts/admin/import-static-snapshot"

export const P4_SCRATCH = "facai8_p4_test"

export function p4Creds(): ImportCreds {
  const c = readCreds()
  return { host: c.host, port: c.port, database: P4_SCRATCH, user: c.user, password: c.password, poolSize: 5 }
}

/** 建 scratch 库 + 全量迁移（beforeAll 用） */
export async function setupP4Scratch(): Promise<Pool> {
  return freshMigratedPool(P4_SCRATCH)
}

/** 删 scratch 库（afterAll 用；传入的池需已 end） */
export async function teardownP4Scratch(pool: Pool): Promise<void> {
  await pool.end()
  await dropScratch(P4_SCRATCH)
}

/** 向 scratch 执行一次正式导入（库名确认 = scratch） */
export async function importP4Snapshot(version: string): Promise<ImportResult> {
  return runStaticImport(p4Creds(), { snapshotVersion: version, execute: true, confirmDatabase: P4_SCRATCH })
}

/** 向 scratch 执行一次 dry-run */
export async function previewP4Snapshot(version: string): Promise<ImportResult> {
  return runStaticImport(p4Creds(), { snapshotVersion: version, execute: false })
}
