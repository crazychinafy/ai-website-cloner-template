// P6A：标签 Repository（site_tags；注意本表没有 updated_at 列——以实际 DDL 为准，勿引用）
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm"
import { siteLinks, siteTags } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { TagListQuery } from "../validation/tag-schema.ts"
import type { TagDto } from "../dto/content.ts"

type Row = typeof siteTags.$inferSelect

const selection = {
  row: siteTags,
  linkCount: sql<unknown>`(select count(*) from ${siteLinks} sl where sl.tag_id = ${sql.raw("`site_tags`.`id`")})`,
}

export function toTagDto(row: Row, linkCount: unknown): TagDto {
  return {
    id: row.id.toString(),
    name: row.name,
    iconClass: row.iconClass,
    color: row.color,
    bgColor: row.bgColor,
    sortOrder: row.sortOrder,
    status: row.status,
    version: row.version,
    linkCount: Number(linkCount ?? 0),
    createdAt: row.createdAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: siteTags.sortOrder,
  name: siteTags.name,
  id: siteTags.id,
  createdAt: siteTags.createdAt,
} as const

function buildListWhere(q: TagListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(siteTags.deletedAt))
  if (q.q) conds.push(like(siteTags.name, `%${likeEscape(q.q)}%`))
  if (q.status) conds.push(eq(siteTags.status, q.status))
  return and(...conds) ?? sql`1 = 1`
}

export async function listTags(exec: Executor, q: TagListQuery): Promise<{ items: TagDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const order = q.sortDir === "desc" ? desc(SORT_COLS[q.sortBy]) : asc(SORT_COLS[q.sortBy])
  const rows = await db
    .select(selection)
    .from(siteTags)
    .where(where)
    .orderBy(order, asc(siteTags.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(siteTags).where(where)
  return {
    items: rows.map((r) => toTagDto(r.row, r.linkCount)),
    total: Number((cnt as { n: unknown }).n ?? 0),
  }
}

export async function getTagById(exec: Executor, id: string): Promise<TagDto | null> {
  const db = asExecutor(exec)
  const rows = await db.select(selection).from(siteTags).where(eq(siteTags.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toTagDto(r.row, r.linkCount) : null
}

/** 标签引用数（含软删除网址；删除保护） */
export async function countLinksByTagIds(exec: Executor, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const db = asExecutor(exec)
  const rows = await db
    .select({ tagId: siteLinks.tagId, n: sql<unknown>`count(*)` })
    .from(siteLinks)
    .where(inArray(siteLinks.tagId, ids.map(BigInt)))
    .groupBy(siteLinks.tagId)
  return new Map(rows.map((r) => [r.tagId?.toString() ?? "0", Number(r.n ?? 0)]))
}

export async function findTagNameConflict(exec: Executor, name: string, excludeId?: string): Promise<string | null> {
  const db = asExecutor(exec)
  const conds: (SQL | undefined)[] = [eq(siteTags.name, name), isNull(siteTags.deletedAt)]
  if (excludeId) conds.push(ne(siteTags.id, BigInt(excludeId)))
  const rows = await db.select({ id: siteTags.id }).from(siteTags).where(and(...conds)).limit(1)
  return rows[0] ? rows[0].id.toString() : null
}

export async function maxTagSortOrder(exec: Executor): Promise<number> {
  const db = asExecutor(exec)
  const rows = await db
    .select({ m: sql<unknown>`coalesce(max(${siteTags.sortOrder}), 0)` })
    .from(siteTags)
    .where(isNull(siteTags.deletedAt))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

export interface NewTagValues {
  name: string
  iconClass: string
  color: string
  bgColor: string
  sortOrder: number
  status: "active" | "disabled"
}

export async function insertTag(tx: AdminTx, v: NewTagValues): Promise<string> {
  await asExecutor(tx)
    .insert(siteTags)
    .values({
      name: v.name,
      iconClass: v.iconClass,
      color: v.color,
      bgColor: v.bgColor,
      sortOrder: v.sortOrder,
      status: v.status,
    })
  return lastInsertIdString(tx)
}

export interface TagPatch {
  name?: string
  iconClass?: string
  color?: string
  bgColor?: string
  sortOrder?: number
  status?: "active" | "disabled"
}

export async function updateTagWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  patch: TagPatch,
): Promise<boolean> {
  const set: Record<string, unknown> = { version: sql`${siteTags.version} + 1` }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.iconClass !== undefined) set.iconClass = patch.iconClass
  if (patch.color !== undefined) set.color = patch.color
  if (patch.bgColor !== undefined) set.bgColor = patch.bgColor
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  if (patch.status !== undefined) set.status = patch.status
  const res = (await asExecutor(tx)
    .update(siteTags)
    .set(set)
    .where(and(eq(siteTags.id, BigInt(id)), eq(siteTags.version, expectedVersion), isNull(siteTags.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteTag(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteTags)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${siteTags.version} + 1`,
    })
    .where(and(eq(siteTags.id, BigInt(id)), eq(siteTags.version, expectedVersion), isNull(siteTags.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function restoreTag(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteTags)
    .set({
      deletedAt: null,
      version: sql`${siteTags.version} + 1`,
    })
    .where(
      and(eq(siteTags.id, BigInt(id)), eq(siteTags.version, expectedVersion), sql`${siteTags.deletedAt} is not null`),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
