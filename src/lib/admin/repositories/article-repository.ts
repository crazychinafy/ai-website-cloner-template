// P6C：文章管理 Repository（唯一允许直接接触 articles 表的模块）
// ─────────────────────────────────────────────────────────────────
// - 与 link-repository 同约定：Executor（池或事务）；BIGINT 入参为校验过的十进制字符串；
//   乐观锁 UPDATE 带 version + deleted_at IS NULL 双条件
// - 列表相关子查询不需要（分类名走 category_name_snapshot 列，前台同源语义）
// - 排序合同（§P6C）：sortBy 为服务端白名单；非 id 列排序追加同向 id 次级排序
//   （默认 updatedAt desc + id DESC，翻页稳定）
// - 锁序：文章事务一律「先锁 articles 自身行，再读 article_categories 父行」
import "server-only"
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm"
import { articles } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { ArticleListQuery } from "../validation/article-schema.ts"
import type { ArticleDto } from "../dto/article.ts"

export type ArticleRow = typeof articles.$inferSelect

export function toArticleDto(row: ArticleRow): ArticleDto {
  return {
    id: row.id.toString(),
    categoryId: row.categoryId.toString(),
    categoryName: row.categoryNameSnapshot,
    title: row.title,
    contentHtml: row.contentHtml,
    coverImage: row.coverImage,
    seoTitle: row.seoTitle,
    seoKeywords: row.seoKeywords,
    seoDescription: row.seoDescription,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    status: row.status,
    viewCount: row.viewCount.toString(),
    publishedAt: row.publishedAt ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

const SORT_COLS = {
  updatedAt: articles.updatedAt,
  createdAt: articles.createdAt,
  publishedAt: articles.publishedAt,
  viewCount: articles.viewCount,
  title: articles.title,
  id: articles.id,
} as const

/** 白名单排序 + 同向 id 次级排序（id 列本身不重复） */
function buildOrder(q: ArticleListQuery) {
  const col = SORT_COLS[q.sortBy]
  const primary = q.sortDir === "desc" ? desc(col) : asc(col)
  if (q.sortBy === "id") return [primary]
  return [primary, q.sortDir === "desc" ? desc(articles.id) : asc(articles.id)]
}

/** 列表 where：q 命中标题/作者名；status/categoryId 精确；includeDeleted 控制软删除可见性 */
function buildListWhere(q: ArticleListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(articles.deletedAt))
  if (q.q) {
    const t = `%${likeEscape(q.q)}%`
    conds.push(or(like(articles.title, t), like(articles.authorName, t)))
  }
  if (q.status) conds.push(eq(articles.status, q.status))
  if (q.categoryId) conds.push(eq(articles.categoryId, BigInt(q.categoryId)))
  return and(...conds) ?? sql`1 = 1`
}

export async function listArticles(exec: Executor, q: ArticleListQuery): Promise<{ items: ArticleDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const rows = await db
    .select()
    .from(articles)
    .where(where)
    .orderBy(...buildOrder(q))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(articles).where(where)
  return { items: rows.map(toArticleDto), total: Number((cnt as { n: unknown }).n ?? 0) }
}

/** 按 ID 取 DTO（含软删除行；回收站详情/编辑后回读用） */
export async function getArticleDto(exec: Executor, id: string): Promise<ArticleDto | null> {
  const rows = await asExecutor(exec).select().from(articles).where(eq(articles.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r ? toArticleDto(r) : null
}

/**
 * 写路径行锁（SELECT ... FOR UPDATE；含正文，审计摘要需要旧值 digest）。
 * 仅在事务内调用；关闭「读取 version/状态 → 更新」之间的 TOCTOU。
 */
export async function lockArticleForUpdate(exec: Executor, id: string): Promise<ArticleRow | null> {
  const rows = await asExecutor(exec).select().from(articles).where(eq(articles.id, BigInt(id))).limit(1).for("update")
  return rows[0] ?? null
}

// ── 写（仅事务内调用）───────────────────────────────────────────

export interface NewArticleValues {
  categoryId: string
  title: string
  contentHtml: string
  coverImage: string
  categoryNameSnapshot: string
  seoTitle: string
  seoKeywords: string
  seoDescription: string
  authorName: string
}

/** 新建（恒 draft、published_at 走列默认 NULL）；返回数据库生成的精确十进制 ID */
export async function insertArticle(tx: AdminTx, v: NewArticleValues): Promise<string> {
  await asExecutor(tx)
    .insert(articles)
    .values({
      categoryId: BigInt(v.categoryId),
      title: v.title,
      contentHtml: v.contentHtml,
      coverImage: v.coverImage,
      categoryNameSnapshot: v.categoryNameSnapshot,
      seoTitle: v.seoTitle,
      seoKeywords: v.seoKeywords,
      seoDescription: v.seoDescription,
      authorName: v.authorName,
      status: "draft",
    })
  return lastInsertIdString(tx)
}

export interface ArticlePatch {
  title?: string
  contentHtml?: string
  coverImage?: string
  categoryId?: string
  categoryNameSnapshot?: string
  seoTitle?: string
  seoKeywords?: string
  seoDescription?: string
}

/**
 * 乐观锁更新：WHERE id AND version AND deleted_at IS NULL。
 * 绝不触碰 published_at/view_count/author_name（编辑不覆盖发布与统计语义）。
 */
export async function updateArticleWithVersion(tx: AdminTx, id: string, expectedVersion: number, patch: ArticlePatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${articles.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.contentHtml !== undefined) set.contentHtml = patch.contentHtml
  if (patch.coverImage !== undefined) set.coverImage = patch.coverImage
  if (patch.categoryId !== undefined) set.categoryId = BigInt(patch.categoryId)
  if (patch.categoryNameSnapshot !== undefined) set.categoryNameSnapshot = patch.categoryNameSnapshot
  if (patch.seoTitle !== undefined) set.seoTitle = patch.seoTitle
  if (patch.seoKeywords !== undefined) set.seoKeywords = patch.seoKeywords
  if (patch.seoDescription !== undefined) set.seoDescription = patch.seoDescription
  const res = (await asExecutor(tx)
    .update(articles)
    .set(set)
    .where(and(eq(articles.id, BigInt(id)), eq(articles.version, expectedVersion), isNull(articles.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/**
 * 状态切换（乐观锁；状态机规则在 Service）。
 * 发布时 published_at = COALESCE(published_at, NOW)：首发写一次，再发布保留历史时间。
 * options.contentHtml：发布闸门顺带写入净化后的正文（历史未清洗正文发布时收敛）。
 */
export async function setArticleStatusWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  status: "draft" | "published" | "archived",
  options?: { contentHtml?: string },
): Promise<boolean> {
  const set: Record<string, unknown> = {
    status,
    version: sql`${articles.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (status === "published") set.publishedAt = sql`coalesce(${articles.publishedAt}, CURRENT_TIMESTAMP(3))`
  if (options?.contentHtml !== undefined) set.contentHtml = options.contentHtml
  const res = (await asExecutor(tx)
    .update(articles)
    .set(set)
    .where(and(eq(articles.id, BigInt(id)), eq(articles.version, expectedVersion), isNull(articles.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function softDeleteArticle(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(articles)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${articles.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(articles.id, BigInt(id)), eq(articles.version, expectedVersion), isNull(articles.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 恢复（状态原样保留；published_at 不动） */
export async function restoreArticle(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(articles)
    .set({
      deletedAt: null,
      version: sql`${articles.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(articles.id, BigInt(id)), eq(articles.version, expectedVersion), sql`${articles.deletedAt} is not null`))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
