// P2：执行 drizzle 版本化迁移（显式、可重复、不自动挂到应用启动流程）
// 用法（凭据经环境变量注入，勿写进文件）：
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=*** DB_NAME=facai8_admin npm run db:migrate
// 行为：
//   1) 确保目标库存在（CREATE DATABASE IF NOT EXISTS ... utf8mb4）
//   2) 运行 drizzle migrator（按 drizzle/meta/_journal.json 跟踪，已应用则空操作）
//   3) 绝不 DROP / TRUNCATE / 清数据；库名白名单校验防误操作
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import mysql from "mysql2/promise"

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, "..", "..", "drizzle")

// 库名白名单：本仓库只允许 facai8 前缀的库（本地 MySQL 上有大量无关库，防误伤）
const DB_NAME = process.env.DB_NAME ?? "facai8_admin"
if (!/^facai8_[a-z0-9_]{1,40}$/.test(DB_NAME)) {
  console.error(`[migrate] 拒绝执行：DB_NAME="${DB_NAME}" 不在白名单（必须匹配 facai8_*）`)
  process.exit(1)
}

const cfg = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "facai8_app",
  password: process.env.DB_PASSWORD ?? "",
  bigNumberStrings: true,
  supportBigNumbers: true,
  timezone: "Z",
  connectTimeout: 10_000,
}

try {
  // 1) 确保目标库存在
  const admin = await mysql.createConnection(cfg)
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  await admin.end()

  // 2) 迁移（migrator 基于 __drizzle_migrations 表跟踪，重复执行 = 空操作）
  const { drizzle } = await import("drizzle-orm/mysql2")
  const { migrate } = await import("drizzle-orm/mysql2/migrator")
  const pool = mysql.createPool({ ...cfg, database: DB_NAME, connectionLimit: 5 })
  const db = drizzle(pool, { mode: "default" })
  await migrate(db, { migrationsFolder })
  await pool.end()

  // 3) 结果摘要
  const check = await mysql.createConnection({ ...cfg, database: DB_NAME })
  const [tables] = await check.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
    [DB_NAME],
  )
  const [journal] = await check.query(
    "SELECT id, created_at FROM __drizzle_migrations ORDER BY id",
  )
  await check.end()
  console.log(
    `[migrate] OK ${DB_NAME}: ${tables.length} tables; applied migrations: ${journal.length} (${journal.map((r) => r.id).join(", ") || "none"})`,
  )
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : null
  console.error(`[migrate] FAIL ${code ?? "error"}: ${err && err.message ? err.message : String(err)}`)
  process.exit(1)
}
