// P2：对 drizzle-kit 生成的 0000 迁移做两处确定性补丁（幂等，可重复执行）。
// 原因：drizzle-kit 0.31.x 的 MySQL 生成器
//   1) 无法在 ON UPDATE 中携带毫秒精度（hardcode "ON UPDATE CURRENT_TIMESTAMP"，且 datetime 列无 onUpdateNow API）；
//   2) 不输出 ENGINE / DEFAULT CHARSET / COLLATE 子句（依赖服务器默认值）。
// 设计基线（docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql）要求：
//   - updated_at 一律 "DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)"
//   - 所有表显式 InnoDB + utf8mb4（不依赖服务器默认）
// 补丁只作用于 0000 初始迁移文件；后续 kit 生成的增量迁移不受影响。
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, "..", "..", "drizzle")

if (!existsSync(drizzleDir)) {
  console.error("[patch-migration] drizzle/ 目录不存在，请先执行 db:migrate 前的 generate 步骤")
  process.exit(1)
}

const files = readdirSync(drizzleDir).filter((f) => /^0000_.*\.sql$/.test(f))
if (files.length !== 1) {
  console.error(`[patch-migration] 预期恰好 1 个 0000 迁移文件，实际 ${files.length}：${files.join(", ")}`)
  process.exit(1)
}

const file = join(drizzleDir, files[0])
let sql = readFileSync(file, "utf8")
let patched = 0

// 补丁 1：updated_at 补 ON UPDATE 毫秒精度（只匹配 kit 生成的固定形态）
{
  const re = /(`updated_at` datetime\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)),/g
  const matches = sql.match(re)
  if (matches) {
    sql = sql.replace(re, "$1 ON UPDATE CURRENT_TIMESTAMP(3),")
    patched += matches.length
  }
  // 已打过补丁则无匹配（幂等）
  if (/ON UPDATE CURRENT_TIMESTAMP\(3\)/.test(sql) === false && matches === null) {
    console.error("[patch-migration] 未找到任何 updated_at 列，请检查 schema 是否变化")
    process.exit(1)
  }
}

// 补丁 2：CREATE TABLE 收尾补显式引擎/字符集（kit 输出以独占行的 ");" 结尾）
{
  const lines = sql.split("\n")
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === ");") {
      lines[i] = ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;"
      n++
    }
  }
  sql = lines.join("\n")
  if (n === 0) {
    // 幂等：已经打过
  } else {
    patched += n
  }
}

// 头部说明（幂等）
const header = `-- 0000 初始迁移：彩搜搜管理后台 23 张表（由 drizzle-kit 0.31.11 从 src/lib/db/schema 生成）
-- 手工补丁（scripts/admin/patch-migration.mjs 施加，可重复执行）：
--   1) 13 个 updated_at 列补 "ON UPDATE CURRENT_TIMESTAMP(3)"（kit 无法生成带 fsp 的 ON UPDATE）
--   2) 23 个 CREATE TABLE 补 "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"（不依赖服务器默认值）
-- 本迁移不含任何 DROP / TRUNCATE / 数据覆盖语句；外键统一后置 ALTER 添加，保证建表顺序安全。
`
if (!sql.startsWith("-- 0000")) {
  sql = header + sql
}

writeFileSync(file, sql, "utf8")
console.log(`[patch-migration] ${files[0]} 补丁完成：${patched} 处修改（ON UPDATE + ENGINE/CHARSET）`)
