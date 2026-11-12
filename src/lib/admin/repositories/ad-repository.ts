// P6D：广告 Repository（ads；列结构与线上 DDL 完全一致——勿引用不存在的列）
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { ads } from "@/lib/db/schema"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { AdListQuery } from "../validation/ad-schema.ts"
import type { AdDto } from "../dto/ad.ts"
import { computeEffectiveStatus } from "../dto/ad.ts"

type Row = typeof ads.$inferSelect

/** 行 → DTO（effectiveStatus 由调用方传入的墙钟 now 计算；绝不写库） */
export function toAdDto(row: Row, now: string): AdDto {
  return {
    id: row.id.toString(),
    position: row.position,
    title: row.title,
    targetUrl: row.targetUrl,
    imagePath: row.imagePath,
    status: row.status,
    effectiveStatus: computeEffectiveStatus(row.status, row.startsAt, row.endsAt, now),
    sortOrder: row.sortOrder,
    version: row.version,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: ads.sortOrder,
  title: ads.title,
  status: ads.status,
  startsAt: ads.startsAt,
  endsAt: ads.endsAt,
  createdAt: ads.createdAt,
  updatedAt: ads.updatedAt,
  id: ads.id,
} as const

function buildOrder(q: AdListQuery) {
  const col = SORT_COLS[q.sortBy]
  const primary = q.sortDir === "desc" ? desc(col) : asc(col)
  if (q.sortBy === "id") return [primary]
  return [primary, desc(ads.id)]
}

function buildListWhere(q: AdListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(ads.deletedAt))
  if (q.q) conds.push(like(ads.title, `%${likeEscape(q.q)}%`))
  if (q.position) conds.push(eq(ads.position, q.position))
  if (q.status) conds.push(eq(ads.status, q.status))
  return and(...conds) ?? sql`1 = 1`
}

export async function listAds(exec: Executor, q: AdListQuery, now: string): Promise<{ items: AdDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const rows = await db.select().from(ads).where(where).orderBy(...buildOrder(q)).limit(q.pageSize).offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(ads).where(where)
  return { items: rows.map((r) => toAdDto(r, now)), total: Number((cnt as { n: unknown }).n ?? 0) }
}

/** 按 ID 取 DTO（含软删除行；软删除判断留给 Service） */
export async function getAdDto(exec: Executor, id: string, now: string): Promise<AdDto | null> {
  const rows = await asExecutor(exec).select().from(ads).where(eq(ads.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toAdDto(r, now) : null
}

/** 写路径行锁（SELECT ... FOR UPDATE；仅在事务内调用） */
export async function lockAdForUpdate(exec: Executor, id: string): Promise<Row | null> {
  const rows = await asExecutor(exec).select().from(ads).where(eq(ads.id, BigInt(id))).limit(1).for("update")
  return rows[0] ?? null
}

/** 批量行锁（reorder 用；调用方保证 ids 已按 ID 升序去重——固定锁顺序防死锁） */
export async function lockAdsForUpdate(exec: Executor, ids: string[]): Promise<Row[]> {
  return asExecutor(exec)
    .select()
    .from(ads)
    .where(inArray(ads.id, ids.map(BigInt)))
    .orderBy(asc(ads.id))
    .for("update")
}

/** 同一 position 有效行（未删除）当前最大 sortOrder（新建默认追加到末尾，§5.4-7） */
export async function maxSortOrderActiveByPosition(exec: Executor, position: string): Promise<number> {
  const rows = await asExecutor(exec)
    .select({ m: sql<unknown>`coalesce(max(${ads.sortOrder}), 0)` })
    .from(ads)
    .where(and(isNull(ads.deletedAt), eq(ads.position, position)))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

// ── 写（仅事务内调用）───────────────────────────────────────────

/** 新建（恒 draft、version=1）；返回数据库生成的精确十进制 ID */
export async function insertAd(
  tx: AdminTx,
  v: {
    position: string
    title: string
    targetUrl: string
    imagePath: string
    sortOrder: number
    startsAt: string | null
    endsAt: string | null
  },
): Promise<string> {
  await asExecutor(tx)
    .insert(ads)
    .values({
      position: v.position,
      title: v.title,
      targetUrl: v.targetUrl,
      imagePath: v.imagePath,
      sortOrder: v.sortOrder,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      status: "draft",
    })
  return lastInsertIdString(tx)
}

export interface AdPatch {
  title?: string
  position?: string
  targetUrl?: string
  imagePath?: string
  sortOrder?: number
  startsAt?: string | null
  endsAt?: string | null
}

/** 乐观锁更新（status 不在此路径——独立状态机接口） */
export async function updateAdWithVersion(tx: AdminTx, id: string, expectedVersion: number, patch: AdPatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${ads.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.position !== undefined) set.position = patch.position
  if (patch.targetUrl !== undefined) set.targetUrl = patch.targetUrl
  if (patch.imagePath !== undefined) set.imagePath = patch.imagePath
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  if (patch.startsAt !== undefined) set.startsAt = patch.startsAt
  if (patch.endsAt !== undefined) set.endsAt = patch.endsAt
  const res = (await asExecutor(tx)
    .update(ads)
    .set(set)
    .where(and(eq(ads.id, BigInt(id)), eq(ads.version, expectedVersion), isNull(ads.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** reorder 专用：仅改 sortOrder（乐观锁；状态机不介入） */
export async function setAdSortOrderWithVersion(tx: AdminTx, id: string, expectedVersion: number, sortOrder: number): Promise<boolean> {
  return updateAdWithVersion(tx, id, expectedVersion, { sortOrder })
}

/** 状态切换（draft→active / active→disabled / disabled→active / *→expired；合法性在 Service 状态机） */
export async function setAdStatusWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  status: "active" | "disabled" | "expired",
): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(ads)
    .set({ status, version: sql`${ads.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(ads.id, BigInt(id)), eq(ads.version, expectedVersion), isNull(ads.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteAd(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(ads)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP(3)`, version: sql`${ads.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(ads.id, BigInt(id)), eq(ads.version, expectedVersion), isNull(ads.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 恢复：保留原 position/sort_order/starts_at/ends_at/status（只清 deleted_at，§5.7） */
export async function restoreAd(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(ads)
    .set({ deletedAt: null, version: sql`${ads.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(ads.id, BigInt(id)), eq(ads.version, expectedVersion), sql`${ads.deletedAt} is not null`))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
