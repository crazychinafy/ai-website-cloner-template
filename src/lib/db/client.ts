// P1：MySQL 连接池（仅 Node.js 服务端可用）
// - import "server-only"：被 Client Component 模块导入时构建/运行即抛错，阻止凭据代码进浏览器
// - 惰性单例：加载本模块不建立任何连接；static 模式下永远不会创建池（无 DB 环境可正常启动）
// - BIGINT 一律以字符串返回（supportBigNumbers + bigNumberStrings），源站 17 位 ID 不丢精度
// - 时间统一策略：会话时区 UTC；DATETIME(3) 在 schema 中以 mode "string" 读回墙钟字符串，避免本地时区漂移
// - 日志只输出错误码，绝不打印连接串、密码或 SQL 文本
import "server-only"
import mysql from "mysql2/promise"
import type { Pool } from "mysql2/promise"
import { EventEmitter } from "node:events"
import { drizzle } from "drizzle-orm/mysql2"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { getAdminEnv } from "@/lib/admin/validation/env"
import { binaryColumnCast } from "@/lib/db/mysql-cast"
import * as schema from "@/lib/db/schema"

type AppDb = MySql2Database<typeof schema>

/** P3+ 业务模块对 Drizzle 实例的依赖注入类型（测试可传入 scratch 库实例） */
export type AdminDb = AppDb

let pool: Pool | null = null
let db: AppDb | null = null

/** 获取共享连接池（首次调用时按 env 创建；连接为惰性建立） */
export function getDb(): Pool {
  if (pool) return pool
  const env = getAdminEnv()
  pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: env.DB_POOL_SIZE,
    waitForConnections: true,
    queueLimit: 0,
    bigNumberStrings: true,
    supportBigNumbers: true,
    timezone: "Z",
    connectTimeout: 10_000,
    charset: "UTF8MB4_UNICODE_CI",
    namedPlaceholders: false,
    // VARBINARY 列（审计 IP）按原始字节回读：utf8 连接下 mysql2 文本解码会毁掉 ≥0x80 字节
    typeCast: binaryColumnCast,
  })
  // mysql2 的 Pool 事件类型未暴露通用 "error" 重载：按 EventEmitter 注册连接级错误监听
  ;(pool as unknown as EventEmitter).on("error", (err: Error & { code?: string }) => {
    console.error(`[db] pool connection error: ${err.code ?? "unknown"}`)
  })
  return pool
}

/** 获取 Drizzle 实例（绑定共享池 + schema；仅在服务端调用） */
export function getDrizzle(): AppDb {
  if (!db) db = drizzle(getDb(), { schema, mode: "default" })
  return db
}

/** 优雅关闭（脚本/测试/进程退出时调用） */
export async function closeDb(): Promise<void> {
  db = null
  if (!pool) return
  const p = pool
  pool = null
  await p.end()
}
