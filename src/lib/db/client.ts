// P1：MySQL 连接池（仅 Node.js 服务端可用）
// - import "server-only"：被 Client Component 模块导入时构建/运行即抛错，阻止凭据代码进浏览器
// - 惰性单例：加载本模块不建立任何连接；static 模式下永远不会创建池（无 DB 环境可正常启动）
// - BIGINT 一律以字符串返回（sourceBigNumbers + bigNumberStrings），源站 17 位 ID 不丢精度
// - 日志只输出错误码，绝不打印连接串、密码或 SQL 文本
import "server-only"
import mysql from "mysql2/promise"
import type { Pool } from "mysql2/promise"
import { EventEmitter } from "node:events"
import { getAdminEnv } from "@/lib/admin/validation/env"

let pool: Pool | null = null

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
    connectTimeout: 10_000,
    charset: "UTF8MB4_UNICODE_CI",
    namedPlaceholders: false,
  })
  // mysql2 的 Pool 事件类型未暴露通用 "error" 重载：按 EventEmitter 注册连接级错误监听
  ;(pool as unknown as EventEmitter).on("error", (err: Error & { code?: string }) => {
    console.error(`[db] pool connection error: ${err.code ?? "unknown"}`)
  })
  return pool
}

/** 优雅关闭（脚本/测试/进程退出时调用） */
export async function closeDb(): Promise<void> {
  if (!pool) return
  const p = pool
  pool = null
  await p.end()
}
