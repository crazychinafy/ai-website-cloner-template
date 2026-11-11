// P6A：文章分类 Service（article_categories 独立资源；模式与 category-service 一致）
// 删除保护：分类下的文章（含软删除）> 0 → 拒绝。全局排序（无父级作用域）。
// P6A.1：恢复前复查同名冲突（409 ARTICLE_CATEGORY_NAME_CONFLICT）；创建/改名/恢复竞态由
// uq_article_categories_active_name 兜底，ER_DUP_ENTRY 映射为业务错误。
import "server-only"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import type { WriteCtx } from "../audit/audit-writer.ts"
import { writeAudit } from "../audit/audit-writer.ts"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { asExecutor, isUniqueRaceError } from "../repositories/executor.ts"
import * as repo from "../repositories/article-category-repository.ts"
import type {
  ArticleCategoryListQuery,
  CreateArticleCategoryInput,
  ReorderArticleCategoriesInput,
  UpdateArticleCategoryInput,
} from "../validation/article-category-schema.ts"
import type { StatusChangeInput } from "./category-service.ts"
import type { ArticleCategoryDto } from "../dto/content.ts"
import { pageResult } from "../dto/content.ts"

const RT = "article_category"

export async function listArticleCategories(q: ArticleCategoryListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await repo.listArticleCategories(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getArticleCategory(id: string, db: AdminDb = getDrizzle()) {
  const row = await repo.getArticleCategoryById(asExecutor(db), id)
  if (!row) throw notFound()
  return { data: row }
}

export async function createArticleCategory(
  ctx: WriteCtx,
  input: CreateArticleCategoryInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleCategoryDto }> {
  return db.transaction(async (tx) => {
    const conflict = await repo.findArticleCategoryNameConflict(asExecutor(tx), input.name)
    if (conflict) throw nameConflict()
    const sortOrder = input.sortOrder ?? (await repo.maxArticleCategorySortOrder(asExecutor(tx))) + 1
    let id: string
    try {
      id = await repo.insertArticleCategory(tx, {
        name: input.name,
        iconClass: input.iconClass ?? "",
        sortOrder,
        status: input.status ?? "active",
      })
    } catch (e) {
      // 并发同名竞态 → uq_article_categories_active_name 兜底（422 与预检查路径同契约）
      if (isUniqueRaceError(e)) throw nameConflict()
      throw e
    }
    const record = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!record) throw new ContentError(500, "INTERNAL_ERROR", "文章分类创建后读取失败")
    await writeAudit(tx, ctx, {
      action: "article_category.create",
      resourceType: RT,
      resourceId: id,
      before: null,
      after: { name: record.name, icon_class: record.iconClass, sort_order: record.sortOrder, status: record.status },
    })
    return { data: record }
  })
}

export async function updateArticleCategory(
  ctx: WriteCtx,
  id: string,
  input: UpdateArticleCategoryInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleCategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()

    const patch: repo.ArticleCategoryPatch = {}
    if (input.name !== undefined) {
      const conflict = await repo.findArticleCategoryNameConflict(asExecutor(tx), input.name, id)
      if (conflict) throw nameConflict()
      patch.name = input.name
    }
    if (input.iconClass !== undefined) patch.iconClass = input.iconClass
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
    if (input.status !== undefined) patch.status = input.status

    let ok: boolean
    try {
      ok = await repo.updateArticleCategoryWithVersion(tx, id, input.version, patch)
    } catch (e) {
      if (isUniqueRaceError(e)) throw nameConflict()
      throw e
    }
    if (!ok) throw versionConflict()
    const record = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    const before: Record<string, unknown> = {}
    if (input.name !== undefined) before.name = current.name
    if (input.iconClass !== undefined) before.icon_class = current.iconClass
    if (input.sortOrder !== undefined) before.sort_order = current.sortOrder
    if (input.status !== undefined) before.status = current.status
    const after: Record<string, unknown> = {}
    if (input.name !== undefined) after.name = input.name
    if (input.iconClass !== undefined) after.icon_class = input.iconClass
    if (input.sortOrder !== undefined) after.sort_order = input.sortOrder
    if (input.status !== undefined) after.status = input.status
    await writeAudit(tx, ctx, {
      action: "article_category.update",
      resourceType: RT,
      resourceId: id,
      before,
      after,
    })
    return { data: record }
  })
}

export async function changeArticleCategoryStatus(
  ctx: WriteCtx,
  id: string,
  input: StatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleCategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()
    const ok = await repo.updateArticleCategoryWithVersion(tx, id, input.version, { status: input.status })
    if (!ok) throw versionConflict()
    const record = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: input.status === "active" ? "article_category.enable" : "article_category.disable",
      resourceType: RT,
      resourceId: id,
      before: { status: current.status },
      after: { status: input.status },
    })
    return { data: record }
  })
}

export async function reorderArticleCategories(
  ctx: WriteCtx,
  input: ReorderArticleCategoriesInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: ArticleCategoryDto[] } }> {
  return db.transaction(async (tx) => {
    const records: ArticleCategoryDto[] = []
    for (const item of input.items) {
      const row = await repo.getArticleCategoryById(asExecutor(tx), item.id)
      if (!row || row.deletedAt) throw notFound()
      if (row.version !== item.version) throw versionConflict()
      const ok = await repo.updateArticleCategoryWithVersion(tx, item.id, item.version, { sortOrder: item.sortOrder })
      if (!ok) throw versionConflict()
    }
    for (const item of input.items) {
      const r = await repo.getArticleCategoryById(asExecutor(tx), item.id)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "article_category.reorder",
      resourceType: RT,
      resourceId: "global",
      before: null,
      after: { items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })) },
    })
    return { data: { records } }
  })
}

export async function deleteArticleCategory(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleCategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (version !== current.version) throw versionConflict()
    const counts = await repo.countArticlesByCategoryIds(asExecutor(tx), [id])
    const n = counts.get(id) ?? 0
    if (n > 0) {
      throw new ContentError(
        409,
        "ARTICLE_CATEGORY_HAS_ARTICLES",
        `该分类下仍有 ${n} 篇文章（含已删除），请先转移或删除这些文章`,
      )
    }
    const ok = await repo.softDeleteArticleCategory(tx, id, version)
    if (!ok) throw versionConflict()
    const record = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "article_category.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: null },
      after: { name: record.name, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreArticleCategory(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleCategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!current) throw notFound()
    if (!current.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该分类未被删除，无需恢复")
    if (version !== current.version) throw versionConflict()
    // P6A.1：恢复前复查全局同名（软删除期间同名分类可能已被新建）→ 409 业务冲突
    const conflict = await repo.findArticleCategoryNameConflict(asExecutor(tx), current.name, id)
    if (conflict) throw restoreNameConflict(current.name)
    let ok: boolean
    try {
      ok = await repo.restoreArticleCategory(tx, id, version)
    } catch (e) {
      // 并发恢复/新建竞态 → uq_article_categories_active_name 兜底
      if (isUniqueRaceError(e)) throw restoreNameConflict(current.name)
      throw e
    }
    if (!ok) throw versionConflict()
    const record = await repo.getArticleCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "article_category.restore",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: current.deletedAt },
      after: { name: record.name, deleted_at: null },
    })
    return { data: record }
  })
}

function notFound(): ContentError {
  return new ContentError(404, "ARTICLE_CATEGORY_NOT_FOUND", "文章分类不存在或已被删除")
}

function nameConflict(): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "文章分类名称已存在", { name: "文章分类名称已存在" })
}

/** P6A.1：恢复时名称已被占用（预检查命中或 UNIQUE 索引竞态兜底） */
function restoreNameConflict(name: string): ContentError {
  return new ContentError(409, "ARTICLE_CATEGORY_NAME_CONFLICT", `同名文章分类「${name}」已存在，无法恢复`, {
    name: `同名文章分类「${name}」已存在，无法恢复`,
  })
}
