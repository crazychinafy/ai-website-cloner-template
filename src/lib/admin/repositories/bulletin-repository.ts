// P6C：公告管理 Repository（唯一允许直接接触 bulletins 表的模块）
// ─────────────────────────────────────────────────────────────────
// - 列表默认排序 sortOrder ASC + id DESC 次级（置顶语义，翻页稳定）
// - reorder 在 Service 单事务内逐行 lock + 乐观锁更新（任一失败整批回滚）
// - published_at 语义与文章一致：COALESCE 首发写一次，归档/再发布不覆盖
import "server-only"
import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm"
import { bulletins } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import { sanitizeRichHtml } from "../security/html-sanitizer.ts"
import type { BulletinListQuery } from "../validation/bulletin-schema.ts"
import type { BulletinDto } from "../dto/bulletin.ts"

export type BulletinRow = typeof bulletins.$inferSelect

export function toBulletinDto(row: BulletinRow): BulletinDto {
  return {
    id: row.id.toString(),
    title: row.title,
    contentHtml: row.contentHtml,
    // 整改问题 01：编辑器安全正文（读路径内存净化副本，库内不改；见文章 repo）
    editorHtml: sanitizeRichHtml(row.contentHtml),
    status: row.status,
    sortOrder: row.sortOrder,
    publishedAt: row.publishedAt ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: bulletins.sortOrder,
  title: bulletins.title,
  publishedAt: bulletins.publishedAt,
  createdAt: bulletins.createdAt,
  updatedAt: bulletins.updatedAt,
  id: bulletins.id,
} as const

/** 白名单排序；非 id 列排序追加 id DESC 次级（置顶行同值时新公告在前） */
function buildOrder(q: BulletinListQuery) {
  const col = SORT_COLS[q.sortBy]
  const primary = q.sortDir === "desc" ? desc(col) : asc(col)
  if (q.sortBy === "id") return [primary]
  return [primary, desc(bulletins.id)]
}

function buildListWhere(q: BulletinListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(bulletins.deletedAt))
  if (q.q) conds.push(like(bulletins.title, `%${likeEscape(q.q)}%`))
  if (q.status) conds.push(eq(bulletins.status, q.status))
  return and(...conds) ?? sql`1 = 1`
}

export async function listBulletins(exec: Executor, q: BulletinListQuery): Promise<{ items: BulletinDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const rows = await db
    .select()
    .from(bulletins)
    .where(where)
    .orderBy(...buildOrder(q))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(bulletins).where(where)
  return { items: rows.map(toBulletinDto), total: Number((cnt as { n: unknown }).n ?? 0) }
}

/** 按 ID 取 DTO（含软删除行） */
export async function getBulletinDto(exec: Executor, id: string): Promise<BulletinDto | null> {
  const rows = await asExecutor(exec).select().from(bulletins).where(eq(bulletins.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toBulletinDto(r) : null
}

/** 写路径行锁（SELECT ... FOR UPDATE；仅在事务内调用） */
export async function lockBulletinForUpdate(exec: Executor, id: string): Promise<BulletinRow | null> {
  const rows = await asExecutor(exec).select().from(bulletins).where(eq(bulletins.id, BigInt(id))).limit(1).for("update")
  return rows[0] ?? null
}

/** 有效行（未删除）当前最大 sortOrder（新建默认追加到末尾） */
export async function maxSortOrderActive(exec: Executor): Promise<number> {
  const rows = await asExecutor(exec)
    .select({ m: sql<unknown>`coalesce(max(${bulletins.sortOrder}), 0)` })
    .from(bulletins)
    .where(isNull(bulletins.deletedAt))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

// ── 写（仅事务内调用）───────────────────────────────────────────

/** 新建（恒 draft、published_at=NULL）；返回数据库生成的精确十进制 ID */
export async function insertBulletin(tx: AdminTx, v: { title: string; contentHtml: string; sortOrder: number }): Promise<string> {
  await asExecutor(tx)
    .insert(bulletins)
    .values({ title: v.title, contentHtml: v.contentHtml, sortOrder: v.sortOrder, status: "draft" })
  return lastInsertIdString(tx)
}

export interface BulletinPatch {
  title?: string
  contentHtml?: string
  sortOrder?: number
}

/** 乐观锁更新（published_at/view 语义列不在此路径） */
export async function updateBulletinWithVersion(tx: AdminTx, id: string, expectedVersion: number, patch: BulletinPatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${bulletins.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.contentHtml !== undefined) set.contentHtml = patch.contentHtml
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  const res = (await asExecutor(tx)
    .update(bulletins)
    .set(set)
    .where(and(eq(bulletins.id, BigInt(id)), eq(bulletins.version, expectedVersion), isNull(bulletins.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** reorder 专用：仅改 sortOrder（乐观锁；状态机不介入） */
export async function setBulletinSortOrderWithVersion(tx: AdminTx, id: string, expectedVersion: number, sortOrder: number): Promise<boolean> {
  return updateBulletinWithVersion(tx, id, expectedVersion, { sortOrder })
}

/** 状态切换（发布时 published_at = COALESCE(旧值, NOW)；归档不覆盖；options.contentHtml 发布闸门收敛正文） */
export async function setBulletinStatusWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  status: "draft" | "published" | "archived",
  options?: { contentHtml?: string },
): Promise<boolean> {
  const set: Record<string, unknown> = {
    status,
    version: sql`${bulletins.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (status === "published") set.publishedAt = sql`coalesce(${bulletins.publishedAt}, CURRENT_TIMESTAMP(3))`
  if (options?.contentHtml !== undefined) set.contentHtml = options.contentHtml
  const res = (await asExecutor(tx)
    .update(bulletins)
    .set(set)
    .where(and(eq(bulletins.id, BigInt(id)), eq(bulletins.version, expectedVersion), isNull(bulletins.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteBulletin(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(bulletins)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${bulletins.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(bulletins.id, BigInt(id)), eq(bulletins.version, expectedVersion), isNull(bulletins.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function restoreBulletin(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(bulletins)
    .set({
      deletedAt: null,
      version: sql`${bulletins.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(bulletins.id, BigInt(id)), eq(bulletins.version, expectedVersion), sql`${bulletins.deletedAt} is not null`))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
