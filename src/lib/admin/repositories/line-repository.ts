// P6D：线路 Repository（site_lines；列结构与线上 DDL 完全一致）
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { siteLines } from "@/lib/db/schema"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { LineListQuery } from "../validation/line-schema.ts"
import type { LineDto } from "../dto/line.ts"

type Row = typeof siteLines.$inferSelect

export function toLineDto(row: Row): LineDto {
  return {
    id: row.id.toString(),
    name: row.name,
    url: row.url,
    status: row.status,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: siteLines.sortOrder,
  name: siteLines.name,
  status: siteLines.status,
  createdAt: siteLines.createdAt,
  updatedAt: siteLines.updatedAt,
  id: siteLines.id,
} as const

/** 白名单排序；非 id 列排序追加 id DESC 次级（稳定排序，§6.5） */
function buildOrder(q: LineListQuery) {
  const col = SORT_COLS[q.sortBy]
  const primary = q.sortDir === "desc" ? desc(col) : asc(col)
  if (q.sortBy === "id") return [primary]
  return [primary, desc(siteLines.id)]
}

function buildListWhere(q: LineListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(siteLines.deletedAt))
  if (q.q) conds.push(like(siteLines.name, `%${likeEscape(q.q)}%`))
  if (q.status) conds.push(eq(siteLines.status, q.status))
  return and(...conds) ?? sql`1 = 1`
}

export async function listLines(exec: Executor, q: LineListQuery): Promise<{ items: LineDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const rows = await db
    .select()
    .from(siteLines)
    .where(where)
    .orderBy(...buildOrder(q))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(siteLines).where(where)
  return { items: rows.map(toLineDto), total: Number((cnt as { n: unknown }).n ?? 0) }
}

/** 按 ID 取 DTO（含软删除行；软删除判断留给 Service） */
export async function getLineDto(exec: Executor, id: string): Promise<LineDto | null> {
  const rows = await asExecutor(exec).select().from(siteLines).where(eq(siteLines.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toLineDto(r) : null
}

/** 写路径行锁（SELECT ... FOR UPDATE；仅在事务内调用） */
export async function lockLineForUpdate(exec: Executor, id: string): Promise<Row | null> {
  const rows = await asExecutor(exec).select().from(siteLines).where(eq(siteLines.id, BigInt(id))).limit(1).for("update")
  return rows[0] ?? null
}

/** 批量行锁（reorder 用；调用方保证 ids 已按 ID 升序去重——固定锁顺序防死锁） */
export async function lockLinesForUpdate(exec: Executor, ids: string[]): Promise<Row[]> {
  return asExecutor(exec)
    .select()
    .from(siteLines)
    .where(inArray(siteLines.id, ids.map(BigInt)))
    .orderBy(asc(siteLines.id))
    .for("update")
}

/** 有效行（未删除）当前最大 sortOrder（新建默认追加到末尾，§6.2） */
export async function maxSortOrderActive(exec: Executor): Promise<number> {
  const rows = await asExecutor(exec)
    .select({ m: sql<unknown>`coalesce(max(${siteLines.sortOrder}), 0)` })
    .from(siteLines)
    .where(isNull(siteLines.deletedAt))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

// ── 写（仅事务内调用）───────────────────────────────────────────

/** 新建（恒 disabled、version=1；§6.2 新建默认停用）；返回数据库生成的精确十进制 ID */
export async function insertLine(tx: AdminTx, v: { name: string; url: string; sortOrder: number }): Promise<string> {
  await asExecutor(tx)
    .insert(siteLines)
    .values({ name: v.name, url: v.url, sortOrder: v.sortOrder, status: "disabled" })
  return lastInsertIdString(tx)
}

export interface LinePatch {
  name?: string
  url?: string
  sortOrder?: number
}

/** 乐观锁更新（status 不在此路径——独立启停接口，§6.3） */
export async function updateLineWithVersion(tx: AdminTx, id: string, expectedVersion: number, patch: LinePatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${siteLines.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.url !== undefined) set.url = patch.url
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  const res = (await asExecutor(tx)
    .update(siteLines)
    .set(set)
    .where(and(eq(siteLines.id, BigInt(id)), eq(siteLines.version, expectedVersion), isNull(siteLines.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** reorder 专用：仅改 sortOrder（乐观锁） */
export async function setLineSortOrderWithVersion(tx: AdminTx, id: string, expectedVersion: number, sortOrder: number): Promise<boolean> {
  return updateLineWithVersion(tx, id, expectedVersion, { sortOrder })
}

/** 启停（active ↔ disabled；合法性在 Service 状态机） */
export async function setLineStatusWithVersion(tx: AdminTx, id: string, expectedVersion: number, status: "active" | "disabled"): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLines)
    .set({ status, version: sql`${siteLines.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(siteLines.id, BigInt(id)), eq(siteLines.version, expectedVersion), isNull(siteLines.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteLine(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLines)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP(3)`, version: sql`${siteLines.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(siteLines.id, BigInt(id)), eq(siteLines.version, expectedVersion), isNull(siteLines.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 恢复：保留原 name/url/status/sort_order（只清 deleted_at，§6.6） */
export async function restoreLine(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLines)
    .set({ deletedAt: null, version: sql`${siteLines.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(siteLines.id, BigInt(id)), eq(siteLines.version, expectedVersion), sql`${siteLines.deletedAt} is not null`))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
