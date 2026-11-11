// P6A：Repository 执行上下文边界
// ─────────────────────────────────────────────────────────────────
// drizzle 的池实例（AdminDb）与事务实例（tx）方法集相同但名义泛型不同；
// Repository 统一接收 Executor（结构子集），服务层用 asExecutor() 单点收敛类型断言。
// 审计/业务写操作必须共用同一个 Executor（事务内），保证原子回滚。
import type { AdminDb } from "@/lib/db/client"

/** db.transaction 回调参数类型（与 admin-auth-service 的 AdminTx 定义一致） */
export type AdminTx = Parameters<Parameters<AdminDb["transaction"]>[0]>[0]

/** Repository 可见的执行接口：池或事务的联合（drizzle 方法在两类型上签名一致） */
export type Executor = AdminDb | AdminTx

/** 池或事务 → Executor（唯一允许的类型收敛点，保留调用处可读性） */
export function asExecutor(db: Executor): Executor {
  return db
}

/** 沿 cause 链找 MySQL 驱动错误码（drizzle 0.45 用 DrizzleQueryError 包裹原始错误在 cause 上） */
function findMySqLError(e: unknown): { code?: unknown; errno?: unknown } | null {
  let cur: unknown = e
  for (let depth = 0; depth < 6 && cur !== null && typeof cur === "object"; depth++) {
    const err = cur as { code?: unknown; errno?: unknown; cause?: unknown }
    if (typeof err.code === "string" || typeof err.errno === "number") return err
    cur = err.cause
  }
  return null
}

/**
 * MySQL 唯一索引冲突（ER_DUP_ENTRY / errno 1062）。
 * P6A.1：Service 在写调用处捕获它并映射为业务错误（422 名称冲突 / 409 恢复冲突），
 * SQL 异常本身绝不透出到客户端。
 */
export function isDuplicateKeyError(e: unknown): boolean {
  const err = findMySqLError(e)
  return err !== null && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)
}

/**
 * InnoDB 死锁牺牲品（ER_LOCK_DEADLOCK / errno 1213）。
 * 两条并发事务同时向 UNIQUE 索引写入同名 key 时，duplicate-check 的 S/X 锁互等
 * 会触发死锁，败者以此码回滚——语义等同「竞态输了」，与 ER_DUP_ENTRY 映射同一业务错误。
 */
export function isUniqueRaceError(e: unknown): boolean {
  const err = findMySqLError(e)
  if (!err) return false
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || err.code === "ER_LOCK_DEADLOCK" || err.errno === 1213
}

/** 事务内取回自增主键：insertId 走 JS number，>2^53 的 BIGINT 会丢精度；
 *  必须用连接级 LAST_INSERT_ID()（文本协议 + bigNumberStrings → 精确十进制字符串） */
export async function lastInsertIdString(tx: AdminTx): Promise<string> {
  const { sql } = await import("drizzle-orm")
  const result = (await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`)) as unknown
  const rows = Array.isArray(result) ? result[0] : result
  const row = Array.isArray(rows) ? rows[0] : rows
  const id = (row as { id?: unknown } | undefined)?.id
  if (id === undefined || id === null || id === 0 || id === "0") {
    throw new Error("[admin-repo] LAST_INSERT_ID() unavailable (insert did not generate auto-increment id)")
  }
  return String(id)
}
