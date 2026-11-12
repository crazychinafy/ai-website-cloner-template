// P4：静态快照导入 CLI（inspect 已由 inspect-static-data.ts 提供）
// 用法：
//   npm run admin:import:preview -- --snapshot-version=2026-11-10          （dry-run：零数据库写入）
//   npm run admin:import -- --execute --snapshot-version=2026-11-10 --confirm-database=facai8_admin
// 安全语义（P4 §8/§13）：
//   - dry-run 不产生任何 INSERT/UPDATE/DELETE（连 admin_import_runs 也不写）
//   - 正式导入必须 --execute 且 --confirm-database 与实际连接库名完全一致
//   - NODE_ENV=production 默认拒绝；需同时提供 --allow-production 参数与 ADMIN_IMPORT_ALLOW_PRODUCTION=1 环境变量
//   - 内容导入 = 单事务（FK 顺序、200-500 条/批）；任何一步失败整体回滚，导入记录标记 failed
//   - 重复导入保护：同版本同 checksum 已成功 → no-op；同版本不同 checksum → 拒绝；内容表非空且无匹配成功记录 → 拒绝冲突
//   - 不使用 ON DUPLICATE KEY UPDATE / INSERT IGNORE；不清空表；started_by 恒为 NULL（CLI 无管理员上下文，不伪造身份）
//   - 凭据来自 DB_* 环境变量（zod 校验）；输出不含密码
// P7：导入核心抽取至 src/lib/admin/import/static-import-core.ts（后台导入管理复用同一实现）；
//     本文件保留 CLI 与兼容再导出（P4 测试与外部脚本的导入路径不变）。
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

import {
  buildStaticSnapshot,
  computeChecksum,
  runStaticImport,
  type ImportCreds,
  type ImportOptions,
  type ImportResult,
  type StaticSnapshot,
} from "../../src/lib/admin/import/static-import-core.ts"

export { buildStaticSnapshot, computeChecksum, runStaticImport }
export type { ImportCreds, ImportOptions, ImportResult, StaticSnapshot }

const envSchema = z.object({
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default("facai8_admin"),
  DB_USER: z.string().min(1).default("facai8_app"),
  DB_PASSWORD: z.string().default(""),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
})

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const a of argv) {
    const eqPos = a.indexOf("=")
    if (a.startsWith("--")) {
      if (eqPos === -1) out[a.slice(2)] = true
      else out[a.slice(2, eqPos)] = a.slice(eqPos + 1)
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const version = typeof args["snapshot-version"] === "string" ? args["snapshot-version"] : ""
  if (!version) {
    console.error("缺少 --snapshot-version=<版本号>（如 2026-11-10）")
    console.error(
      "用法: node scripts/admin/import-static-snapshot.ts --snapshot-version=2026-11-10 [--execute] [--confirm-database=NAME] [--allow-production] [--json=path]",
    )
    process.exit(1)
  }
  const env = envSchema.parse(process.env)
  const creds: ImportCreds = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    poolSize: env.DB_POOL_SIZE,
  }
  const result = await runStaticImport(creds, {
    snapshotVersion: version,
    execute: Boolean(args["execute"]),
    confirmDatabase: typeof args["confirm-database"] === "string" ? args["confirm-database"] : undefined,
    allowProduction: Boolean(args["allow-production"]),
    productionEnvAuthorized: process.env.ADMIN_IMPORT_ALLOW_PRODUCTION === "1",
  })
  console.log(`\n== P4 静态快照导入（${result.mode}）==`)
  for (const line of result.report) console.log(line)
  console.log(`\n结果: ${result.outcome}${result.error ? ` —— ${result.error}` : ""}`)
  if (result.dbCounts) {
    console.log(`数据库回查: ${Object.entries(result.dbCounts).map(([t, n]) => `${t}=${n}`).join(" ")}`)
  }
  const jsonPath = typeof args["json"] === "string" ? args["json"] : undefined
  if (jsonPath) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(jsonPath, JSON.stringify({ version, ...result }, null, 2))
    console.log(`JSON 报告: ${jsonPath}`)
  }
  process.exit(result.ok ? 0 : 1)
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isDirectRun) {
  main().catch((err: Error) => {
    console.error(`[import] FAIL: ${err.message}`)
    process.exit(1)
  })
}
