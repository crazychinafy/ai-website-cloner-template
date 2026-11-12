// P6A：文章分类 Repository（article_categories 独立一级资源，无父级）
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm"
import { articleCategories, articles } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { ArticleCategoryListQuery } from "../validation/article-category-schema.ts"
import type { ArticleCategoryDto } from "../dto/content.ts"

type Row = typeof articleCategories.$inferSelect

const selection = {
  row: articleCategories,
  articleCount: sql<unknown>`(select count(*) from ${articles} a where a.category_id = ${sql.raw("`article_categories`.`id`")})`,
}

export function toArticleCategoryDto(row: Row, articleCount: unknown): ArticleCategoryDto {
  return {
    id: row.id.toString(),
    name: row.name,
    iconClass: row.iconClass,
    sortOrder: row.sortOrder,
    status: row.status,
    version: row.version,
    articleCount: Number(articleCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  sortOrder: articleCategories.sortOrder,
  name: articleCategories.name,
  id: articleCategories.id,
  createdAt: articleCategories.createdAt,
} as const

function buildListWhere(q: ArticleCategoryListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(articleCategories.deletedAt))
  if (q.q) conds.push(like(articleCategories.name, `%${likeEscape(q.q)}%`))
  if (q.status) conds.push(eq(articleCategories.status, q.status))
  return and(...conds) ?? sql`1 = 1`
}

export async function listArticleCategories(
  exec: Executor,
  q: ArticleCategoryListQuery,
): Promise<{ items: ArticleCategoryDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const order = q.sortDir === "desc" ? desc(SORT_COLS[q.sortBy]) : asc(SORT_COLS[q.sortBy])
  const rows = await db
    .select(selection)
    .from(articleCategories)
    .where(where)
    .orderBy(order, asc(articleCategories.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(articleCategories).where(where)
  return {
    items: rows.map((r) => toArticleCategoryDto(r.row, r.articleCount)),
    total: Number((cnt as { n: unknown }).n ?? 0),
  }
}

export async function getArticleCategoryById(exec: Executor, id: string): Promise<ArticleCategoryDto | null> {
  const db = asExecutor(exec)
  const rows = await db
    .select(selection)
    .from(articleCategories)
    .where(eq(articleCategories.id, BigInt(id)))
    .limit(1)
  const r = rows[0]
  return r ? toArticleCategoryDto(r.row, r.articleCount) : null
}

/** 写路径分类行锁需要的最小字段（整改问题 02） */
export interface ArticleCategoryBrief {
  id: string
  name: string
  status: string
  deletedAt: string | null
}

/**
 * 分类行锁（SELECT ... FOR UPDATE；整改问题 02）。
 * - 锁定读永远看到最新已提交行并阻塞并发停用/软删除，关闭文章
 *   「create/update/publish/restore 检查后 → 写前」分类状态被改的 TOCTOU
 * - 锁序约定：文章事务一律「先锁 articles 自身行，再锁本行」（create 无
 *   自身行、首锁分类行），与 article-repository 头注释同序，无反序不死锁
 * - 仅在事务内调用（池上 SELECT ... FOR UPDATE 立即释放，无保护语义）
 */
export async function lockArticleCategoryBriefForUpdate(exec: Executor, id: string): Promise<ArticleCategoryBrief | null> {
  const db = asExecutor(exec)
  const rows = await db
    .select({
      id: articleCategories.id,
      name: articleCategories.name,
      status: articleCategories.status,
      deletedAt: articleCategories.deletedAt,
    })
    .from(articleCategories)
    .where(eq(articleCategories.id, BigInt(id)))
    .limit(1)
    .for("update")
  const r = rows[0]
  if (!r) return null
  return { id: r.id.toString(), name: r.name, status: r.status, deletedAt: r.deletedAt ?? null }
}

/** 本分类的文章引用数（含软删除文章；删除保护） */
export async function countArticlesByCategoryIds(exec: Executor, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const db = asExecutor(exec)
  const rows = await db
    .select({ categoryId: articles.categoryId, n: sql<unknown>`count(*)` })
    .from(articles)
    .where(inArray(articles.categoryId, ids.map(BigInt)))
    .groupBy(articles.categoryId)
  return new Map(rows.map((r) => [r.categoryId?.toString() ?? "0", Number(r.n ?? 0)]))
}

/** 全局同名（未删除）检查 */
export async function findArticleCategoryNameConflict(
  exec: Executor,
  name: string,
  excludeId?: string,
): Promise<string | null> {
  const db = asExecutor(exec)
  const conds: (SQL | undefined)[] = [eq(articleCategories.name, name), isNull(articleCategories.deletedAt)]
  if (excludeId) conds.push(ne(articleCategories.id, BigInt(excludeId)))
  const rows = await db
    .select({ id: articleCategories.id })
    .from(articleCategories)
    .where(and(...conds))
    .limit(1)
  return rows[0] ? rows[0].id.toString() : null
}

export async function maxArticleCategorySortOrder(exec: Executor): Promise<number> {
  const db = asExecutor(exec)
  const rows = await db
    .select({ m: sql<unknown>`coalesce(max(${articleCategories.sortOrder}), 0)` })
    .from(articleCategories)
    .where(isNull(articleCategories.deletedAt))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

export interface NewArticleCategoryValues {
  name: string
  iconClass: string
  sortOrder: number
  status: "active" | "disabled"
}

export async function insertArticleCategory(tx: AdminTx, v: NewArticleCategoryValues): Promise<string> {
  await asExecutor(tx)
    .insert(articleCategories)
    .values({
      name: v.name,
      iconClass: v.iconClass,
      sortOrder: v.sortOrder,
      status: v.status,
    })
  return lastInsertIdString(tx)
}

export interface ArticleCategoryPatch {
  name?: string
  iconClass?: string
  sortOrder?: number
  status?: "active" | "disabled"
}

export async function updateArticleCategoryWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  patch: ArticleCategoryPatch,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${articleCategories.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.iconClass !== undefined) set.iconClass = patch.iconClass
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  if (patch.status !== undefined) set.status = patch.status
  const res = (await asExecutor(tx)
    .update(articleCategories)
    .set(set)
    .where(
      and(
        eq(articleCategories.id, BigInt(id)),
        eq(articleCategories.version, expectedVersion),
        isNull(articleCategories.deletedAt),
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteArticleCategory(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(articleCategories)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${articleCategories.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(articleCategories.id, BigInt(id)),
        eq(articleCategories.version, expectedVersion),
        isNull(articleCategories.deletedAt),
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function restoreArticleCategory(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(articleCategories)
    .set({
      deletedAt: null,
      version: sql`${articleCategories.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(
      and(
        eq(articleCategories.id, BigInt(id)),
        eq(articleCategories.version, expectedVersion),
        sql`${articleCategories.deletedAt} is not null`,
      ),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
