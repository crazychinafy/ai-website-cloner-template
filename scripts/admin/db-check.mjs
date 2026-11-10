// P1 连通性自检（只读）：验证当前进程 env 的 DB_* 可连接并执行 SELECT 1。
// 用法（凭据从环境注入，勿写进任何文件）：
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=facai8_app DB_PASSWORD=*** DB_NAME=facai8_admin node scripts/admin/db-check.mjs
// 本脚本只使用 mysql2，不 import 应用代码（server-only 模块禁止在裸 Node 客户端条件下加载）。
// 输出不含密码/连接串。
import mysql from "mysql2/promise"

const cfg = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "facai8_admin",
  user: process.env.DB_USER ?? "facai8_app",
  password: process.env.DB_PASSWORD ?? "",
  bigNumberStrings: true,
  supportBigNumbers: true,
  connectionLimit: 1,
  connectTimeout: 8000,
}

try {
  const conn = await mysql.createConnection(cfg)
  const [rows] = await conn.query("SELECT 1 AS ok")
  const [ver] = await conn.query("SELECT VERSION() AS v")
  const [big] = await conn.query("SELECT CAST(18446744073709551615 AS CHAR) AS max")
  await conn.end()
  if (String(rows[0].ok) !== "1") throw new Error("SELECT 1 returned unexpected value")
  console.log(
    `OK: SELECT 1 @ ${cfg.host}:${cfg.port}/${cfg.database} as ${cfg.user}; server=${ver[0].v}; BIGINT-string-check=${big[0].max.length}digits`,
  )
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : null
  console.error(`FAIL: cannot connect ${cfg.host}:${cfg.port} as ${cfg.user} (${cfg.database}): ${code ?? err?.message ?? err}`)
  process.exit(1)
}
