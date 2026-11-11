// P6A：网址分类 Repository（唯一允许直接接触 link_categories 的内容管理模块）
// ─────────────────────────────────────────────────────────────────
// - 所有查询通过 Executor（池或事务实例）；Service 在事务内调用写路径
// - BIGINT id 入参已是校验过的十进制字符串 → BigInt() 仅在此边界使用
// - 计数（linkCount/childCount）用相关子查询：行数 ≤100/页，3.8k 链接量级毫秒返回
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm"
import { linkCategories, siteLinks } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { CategoryListQuery } from "../validation/category-schema.ts"
import type { CategoryDto } from "../dto/content.ts"
import { idToString } from "../dto/content.ts"

type Row = typeof linkCategories.$inferSelect

/** 页面/接口可见字段 + 计数（相关子查询，语义见 DTO 注释）
 * 注意：drizzle 裸 SQL 里 ${table.id} 渲染为不带表名的 `id`，在子查询作用域会绑定到子查询自身表；
 * 关联外层必须用 sql.raw 显式限定表名（否则 count 恒 0 / 错列）。 */
const selection = {
  row: linkCategories,
  linkCount: sql<unknown>`(select count(*) from ${siteLinks} sl where sl.category_id = ${sql.raw("`link_categories`.`id`")})`,
  childCount: sql<unknown>`(
    select count(*) from ${linkCategories} ch
    where ch.parent_id = ${sql.raw("`link_categories`.`id`")} and ch.deleted_at is null
  )`,
}

export function toCategoryDto(row: Row, linkCount: unknown, childCount: unknown): CategoryDto {
  return {
    id: row.id.toString(),
    parentId: idToString(row.parentId),
    name: row.name,
    iconClass: row.iconClass,
    sortOrder: row.sortOrder,
    status: row.status,
    version: row.version,
    linkCount: Number(linkCount ?? 0),
    childCount: Number(childCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: linkCategories.sortOrder,
  name: linkCategories.name,
  id: linkCategories.id,
  createdAt: linkCategories.createdAt,
} as const

/** 列表 where（q/status/parentId/includeDeleted；排序字段已是 Zod 白名单） */
function buildListWhere(q: CategoryListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(linkCategories.deletedAt))
  if (q.q) conds.push(like(linkCategories.name, `%${likeEscape(q.q)}%`))
  if (q.status) conds.push(eq(linkCategories.status, q.status))
  if (q.parentId === "none") conds.push(isNull(linkCategories.parentId))
  else if (q.parentId) conds.push(eq(linkCategories.parentId, BigInt(q.parentId)))
  return and(...conds) ?? sql`1 = 1`
}

export async function listCategories(exec: Executor, q: CategoryListQuery): Promise<{ items: CategoryDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const order = q.sortDir === "desc" ? desc(SORT_COLS[q.sortBy]) : asc(SORT_COLS[q.sortBy])
  const rows = await db
    .select(selection)
    .from(linkCategories)
    .where(where)
    .orderBy(order, asc(linkCategories.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db
    .select({ n: sql<unknown>`count(*)` })
    .from(linkCategories)
    .where(where)
  return {
    items: rows.map((r) => toCategoryDto(r.row, r.linkCount, r.childCount)),
    total: Number((cnt as { n: unknown }).n ?? 0),
  }
}

/** 按 ID 取单条（含软删除；计数同列表） */
export async function getCategoryById(exec: Executor, id: string): Promise<CategoryDto | null> {
  const db = asExecutor(exec)
  const rows = await db.select(selection).from(linkCategories).where(eq(linkCategories.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toCategoryDto(r.row, r.linkCount, r.childCount) : null
}

/** 全量未删除行（/tree 用；两级结构行数很小，树组装与过滤在 Service） */
export async function listAllActiveCategories(exec: Executor): Promise<CategoryDto[]> {
  const db = asExecutor(exec)
  const rows = await db
    .select(selection)
    .from(linkCategories)
    .where(isNull(linkCategories.deletedAt))
    .orderBy(asc(linkCategories.sortOrder), asc(linkCategories.id))
  return rows.map((r) => toCategoryDto(r.row, r.linkCount, r.childCount))
}

/** 直接子分类（含软删除；删除保护与恢复前置检查用） */
export async function getDirectChildren(
  exec: Executor,
  parentId: string,
): Promise<Array<{ id: string; name: string; deleted: boolean }>> {
  const db = asExecutor(exec)
  const rows = await db
    .select({ id: linkCategories.id, name: linkCategories.name, deletedAt: linkCategories.deletedAt })
    .from(linkCategories)
    .where(eq(linkCategories.parentId, BigInt(parentId)))
  return rows.map((r) => ({ id: r.id.toString(), name: r.name, deleted: r.deletedAt !== null }))
}

/** 一批分类各自的网址引用数（含软删除网址；删除保护检查） */
export async function countLinksByCategoryIds(exec: Executor, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const db = asExecutor(exec)
  const rows = await db
    .select({ categoryId: siteLinks.categoryId, n: sql<unknown>`count(*)` })
    .from(siteLinks)
    .where(inArray(siteLinks.categoryId, ids.map(BigInt)))
    .groupBy(siteLinks.categoryId)
  return new Map(rows.map((r) => [r.categoryId?.toString() ?? "0", Number(r.n ?? 0)]))
}

/** 同一父级作用域内同名（未删除）检查；excludeId 用于编辑改名 */
export async function findCategoryNameConflict(
  exec: Executor,
  name: string,
  parentId: string | null,
  excludeId?: string,
): Promise<string | null> {
  const db = asExecutor(exec)
  const conds: (SQL | undefined)[] = [eq(linkCategories.name, name), isNull(linkCategories.deletedAt)]
  conds.push(parentId === null ? isNull(linkCategories.parentId) : eq(linkCategories.parentId, BigInt(parentId)))
  if (excludeId) conds.push(ne(linkCategories.id, BigInt(excludeId)))
  const rows = await db.select({ id: linkCategories.id }).from(linkCategories).where(and(...conds)).limit(1)
  return rows[0] ? rows[0].id.toString() : null
}

/** 父级存在性/层级检查用（返回任意删除状态的精简行） */
export async function getCategoryBrief(
  exec: Executor,
  id: string,
): Promise<{ id: string; name: string; parentId: string | null; status: "active" | "disabled"; deletedAt: string | null } | null> {
  const db = asExecutor(exec)
  const rows = await db
    .select({ id: linkCategories.id, name: linkCategories.name, parentId: linkCategories.parentId, status: linkCategories.status, deletedAt: linkCategories.deletedAt })
    .from(linkCategories)
    .where(eq(linkCategories.id, BigInt(id)))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return { id: r.id.toString(), name: r.name, parentId: idToString(r.parentId), status: r.status, deletedAt: r.deletedAt ?? null }
}

/** 作用域内当前最大 sortOrder（新建默认追加到末尾） */
export async function maxSortOrderInScope(exec: Executor, parentId: string | null): Promise<number> {
  const db = asExecutor(exec)
  const conds: (SQL | undefined)[] = [isNull(linkCategories.deletedAt)]
  conds.push(parentId === null ? isNull(linkCategories.parentId) : eq(linkCategories.parentId, BigInt(parentId)))
  const rows = await db
    .select({ m: sql<unknown>`coalesce(max(${linkCategories.sortOrder}), 0)` })
    .from(linkCategories)
    .where(and(...conds))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

export interface NewCategoryValues {
  name: string
  parentId: string | null
  iconClass: string
  sortOrder: number
  status: "active" | "disabled"
}

/** 新建（事务内）。AUTO_INCREMENT 生成 ID；返回精确十进制字符串 */
export async function insertCategory(tx: AdminTx, v: NewCategoryValues): Promise<string> {
  await asExecutor(tx)
    .insert(linkCategories)
    .values({
      name: v.name,
      parentId: v.parentId === null ? null : BigInt(v.parentId),
      iconClass: v.iconClass,
      sortOrder: v.sortOrder,
      status: v.status,
      sourceSnapshot: false, // 本地新建（非静态快照行）
    })
  return lastInsertIdString(tx)
}

export interface CategoryPatch {
  name?: string
  /** 显式移动：null = 移为一级 */
  parentId?: string | null
  iconClass?: string
  sortOrder?: number
  status?: "active" | "disabled"
}

/** 乐观锁更新：WHERE id AND version AND deleted_at IS NULL；true = 更新成功 */
export async function updateCategoryWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  patch: CategoryPatch,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${linkCategories.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.parentId !== undefined) set.parentId = patch.parentId === null ? null : BigInt(patch.parentId)
  if (patch.iconClass !== undefined) set.iconClass = patch.iconClass
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  if (patch.status !== undefined) set.status = patch.status
  const res = (await asExecutor(tx)
    .update(linkCategories)
    .set(set)
    .where(
      and(
        eq(linkCategories.id, BigInt(id)),
        eq(linkCategories.version, expectedVersion),
        isNull(linkCategories.deletedAt),
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 批量排序的单条更新（乐观锁；状态变更在 Service 循环并依赖返回值） */
export async function setCategorySortOrderWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  sortOrder: number,
): Promise<boolean> {
  return updateCategoryWithVersion(tx, id, expectedVersion, { sortOrder })
}

/** 软删除（乐观锁）；true = 成功 */
export async function softDeleteCategory(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(linkCategories)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${linkCategories.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(linkCategories.id, BigInt(id)),
        eq(linkCategories.version, expectedVersion),
        isNull(linkCategories.deletedAt),
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 恢复（乐观锁；WHERE deleted_at IS NOT NULL） */
export async function restoreCategory(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(linkCategories)
    .set({
      deletedAt: null,
      version: sql`${linkCategories.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(linkCategories.id, BigInt(id)),
        eq(linkCategories.version, expectedVersion),
        sql`${linkCategories.deletedAt} is not null`,
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 级联停用子分类（一级分类被停用时；不校验版本，审计在 Service 汇总） */
export async function disableChildrenOf(tx: AdminTx, parentId: string): Promise<number> {
  const res = (await asExecutor(tx)
    .update(linkCategories)
    .set({
      status: "disabled",
      version: sql`${linkCategories.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(linkCategories.parentId, BigInt(parentId)),
        eq(linkCategories.status, "active"),
        isNull(linkCategories.deletedAt),
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0)
}
