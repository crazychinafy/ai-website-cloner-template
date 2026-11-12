// P6C：文章管理 Service（articles）
// ─────────────────────────────────────────────────────────────────
// 架构与 link-service 完全一致：Route → handleWrite（认证+RBAC+CSRF）→ Zod →
// 本 Service → Repository → Drizzle；每个写操作单事务 + 乐观锁 + 同事务审计。
// 领域规则：
// - POST 恒 draft；authorName = 当前管理员 displayName（服务端定，客户端不可传）；
//   categoryNameSnapshot = 实时分类名（分类改名不回写历史文章，快照语义）
// - 正文统一走 security/html-sanitizer 净化后入库（create/update/publish 触点）
// - 状态机：draft→published、draft→archived、published→archived、archived→published；
//   published→draft（撤回）禁止；发布要求分类 active + 正文非空，并顺带收敛
//   历史未清洗正文（发布闸门）；published_at 只在首次发布写（repo COALESCE）
// - 软删除/恢复：软删行对 update/status/delete 一律 404；恢复保留原状态，
//   分类缺失 409 阻断；恢复「已发布」文章还要求分类仍启用（前台可见性一致）
// - 分类关联（整改问题 02）：create/update/publish/restore 的分类状态检查一律在
//   事务内 SELECT ... FOR UPDATE 锁定分类行后执行，杜绝「检查后分类被并发
//   软删除/停用、外键仍放行」的 TOCTOU（软删除不触发外键错误）
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import { sanitizeRichHtml, htmlDigest } from "../security/html-sanitizer.ts"
import { lockArticleCategoryBriefForUpdate } from "../repositories/article-category-repository.ts"
import * as repo from "../repositories/article-repository.ts"
import { asExecutor, type Executor } from "../repositories/executor.ts"
import type { ArticleDto, ArticlePreviewDto } from "../dto/article.ts"
import { pageResult } from "../dto/article.ts"
import type {
  ArticleListQuery,
  ArticlePreviewInput,
  ArticleStatus,
  ArticleStatusChangeInput,
  CreateArticleInput,
  UpdateArticleInput,
} from "../validation/article-schema.ts"

const RT = "article"

// ── 错误工厂 ─────────────────────────────────────────────────────
function notFound(): ContentError {
  return new ContentError(404, "ARTICLE_NOT_FOUND", "文章不存在或已被删除")
}
function transitionBlocked(reason: string): ContentError {
  return new ContentError(422, "ARTICLE_STATUS_TRANSITION", reason)
}
function catMissing(): ContentError {
  return new ContentError(409, "VALIDATION_ERROR", "所属分类不存在（可能已被删除），请重新指定分类")
}
function catDisabled(): ContentError {
  return new ContentError(409, "VALIDATION_ERROR", "所属分类处于停用状态，请先启用该分类")
}
function restoreBlocked(message: string): ContentError {
  return new ContentError(409, "ARTICLE_RESTORE_BLOCKED", message)
}

// ── 状态机（§P6C）───────────────────────────────────────────────
//   draft ──发布──▶ published ──归档──▶ archived ──再发布──▶ published
//     └──直接归档──▶ archived；published ──▶ draft（撤回）禁止
const ALLOWED_TRANSITIONS: Record<ArticleStatus, ReadonlySet<ArticleStatus>> = {
  draft: new Set(["published", "archived"]),
  published: new Set(["archived"]),
  archived: new Set(["published"]),
}

function statusLabel(s: ArticleStatus): string {
  return s === "draft" ? "草稿" : s === "published" ? "已发布" : "已归档"
}

/**
 * 分类关联校验（锁定读；整改问题 02）：存在且未删除，并锁定分类行直到事务提交，
 * 关闭「检查后 → 写入前」分类被并发软删除的 TOCTOU。
 * （编辑/新建允许停用分类——发布/恢复才要求 active，见状态机处。）
 * 必须在事务内调用。
 */
async function assertCategoryUsable(exec: Executor, categoryId: string): Promise<{ name: string }> {
  const cat = await lockArticleCategoryBriefForUpdate(exec, categoryId)
  if (!cat || cat.deletedAt) throw catMissing()
  return { name: cat.name }
}

// ── 读 ───────────────────────────────────────────────────────────

export async function listArticles(q: ArticleListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await repo.listArticles(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getArticle(id: string, db: AdminDb = getDrizzle()) {
  const dto = await repo.getArticleDto(asExecutor(db), id)
  if (!dto) throw notFound()
  return { data: dto }
}

/** 预览（不落库不审计）：body → 净化 HTML；Route 已守卫 create/update 权限 + CSRF */
export function previewArticle(input: ArticlePreviewInput): { data: ArticlePreviewDto } {
  return { data: { html: sanitizeRichHtml(input.contentHtml), title: input.title ?? "" } }
}

// ── 新建（恒 draft；ID 由 AUTO_INCREMENT 生成）──────────────────

export async function createArticle(
  ctx: WriteCtx,
  authorName: string,
  input: CreateArticleInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleDto }> {
  const contentHtml = sanitizeRichHtml(input.contentHtml ?? "")

  return db.transaction(async (tx) => {
    // 整改问题 02：分类检查必须在事务内并 FOR UPDATE 锁分类行——事务外检查存在
    // 「检查通过 → 分类被并发软删除 → 照常插入」竞态（软删除不触发外键错误）
    const cat = await assertCategoryUsable(asExecutor(tx), input.categoryId)
    const id = await repo.insertArticle(tx, {
      categoryId: input.categoryId,
      title: input.title,
      contentHtml,
      coverImage: input.coverImage ?? "",
      categoryNameSnapshot: cat.name,
      seoTitle: input.seoTitle ?? "",
      seoKeywords: input.seoKeywords ?? "",
      seoDescription: input.seoDescription ?? "",
      authorName,
    })
    await writeAudit(tx, ctx, {
      action: "article.create",
      resourceType: RT,
      resourceId: id,
      after: {
        title: input.title,
        categoryId: input.categoryId,
        status: "draft",
        contentHtml: htmlDigest(contentHtml),
      },
    })
    const record = await repo.getArticleDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 编辑（PATCH；无 status；换分类时同步快照）───────────────────

export async function updateArticle(
  ctx: WriteCtx,
  id: string,
  input: UpdateArticleInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockArticleForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()

    const patch: repo.ArticlePatch = {}
    let newCatName: string | undefined
    if (input.categoryId !== undefined && input.categoryId !== locked.categoryId.toString()) {
      const cat = await assertCategoryUsable(asExecutor(tx), input.categoryId)
      patch.categoryId = input.categoryId
      patch.categoryNameSnapshot = cat.name
      newCatName = cat.name
    }
    if (input.title !== undefined) patch.title = input.title
    if (input.coverImage !== undefined) patch.coverImage = input.coverImage
    if (input.seoTitle !== undefined) patch.seoTitle = input.seoTitle
    if (input.seoKeywords !== undefined) patch.seoKeywords = input.seoKeywords
    if (input.seoDescription !== undefined) patch.seoDescription = input.seoDescription
    const sanitizedBody = input.contentHtml !== undefined ? sanitizeRichHtml(input.contentHtml) : undefined
    if (sanitizedBody !== undefined) patch.contentHtml = sanitizedBody

    const ok = await repo.updateArticleWithVersion(tx, id, locked.version, patch)
    if (!ok) throw versionConflict()

    // 审计 diff：标量记新旧值；正文只记 digest（审计表不存全文，§11）
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.title !== undefined) {
      before.title = locked.title
      after.title = input.title
    }
    if (input.categoryId !== undefined && newCatName !== undefined) {
      before.categoryId = locked.categoryId.toString()
      after.categoryId = input.categoryId
    }
    if (input.coverImage !== undefined) {
      before.coverImage = locked.coverImage
      after.coverImage = input.coverImage
    }
    if (input.seoTitle !== undefined) {
      before.seoTitle = locked.seoTitle
      after.seoTitle = input.seoTitle
    }
    if (input.seoKeywords !== undefined) {
      before.seoKeywords = locked.seoKeywords
      after.seoKeywords = input.seoKeywords
    }
    if (input.seoDescription !== undefined) {
      before.seoDescription = locked.seoDescription
      after.seoDescription = input.seoDescription
    }
    if (sanitizedBody !== undefined && sanitizedBody !== locked.contentHtml) {
      before.contentHtml = htmlDigest(locked.contentHtml)
      after.contentHtml = htmlDigest(sanitizedBody)
    }
    await writeAudit(tx, ctx, { action: "article.update", resourceType: RT, resourceId: id, before, after })

    const record = await repo.getArticleDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 状态切换（articles.publish；发布闸门）───────────────────────

export async function changeArticleStatus(
  ctx: WriteCtx,
  id: string,
  input: ArticleStatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockArticleForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()
    if (locked.status === input.status) throw transitionBlocked(`文章已处于${statusLabel(input.status)}状态`)
    if (!ALLOWED_TRANSITIONS[locked.status].has(input.status)) {
      throw transitionBlocked(`不允许从${statusLabel(locked.status)}变更为${statusLabel(input.status)}（已归档的文章可直接再发布）`)
    }

    let sanitizedBody: string | undefined
    if (input.status === "published") {
      // 发布前置校验：分类存在未删且启用；正文净化后非空；历史未清洗正文顺带收敛
      // （整改问题 02：锁定读分类行，与并发停用/软删除串行化）
      const cat = await lockArticleCategoryBriefForUpdate(asExecutor(tx), locked.categoryId.toString())
      if (!cat || cat.deletedAt) throw catMissing()
      if (cat.status !== "active") throw catDisabled()
      const sanitized = sanitizeRichHtml(locked.contentHtml)
      if (sanitized.trim() === "") throw transitionBlocked("正文为空，不能发布")
      if (sanitized !== locked.contentHtml) sanitizedBody = sanitized
    }

    const ok = await repo.setArticleStatusWithVersion(tx, id, locked.version, input.status, {
      contentHtml: sanitizedBody,
    })
    if (!ok) throw versionConflict()

    const before: Record<string, unknown> = { status: locked.status, title: locked.title }
    const after: Record<string, unknown> = { status: input.status }
    if (sanitizedBody !== undefined) {
      before.contentHtml = htmlDigest(locked.contentHtml)
      after.contentHtml = htmlDigest(sanitizedBody)
    }
    await writeAudit(tx, ctx, {
      action: input.status === "published" ? "article.publish" : "article.archive",
      resourceType: RT,
      resourceId: id,
      before,
      after,
    })
    const record = await repo.getArticleDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 软删除 / 恢复 ────────────────────────────────────────────────

export async function deleteArticle(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockArticleForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.softDeleteArticle(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getArticleDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "article.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: null },
      after: { title: record.title, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

/** 恢复保留原状态；分类缺失 409；恢复「已发布」文章要求分类仍启用（前台可见性一致） */
export async function restoreArticle(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: ArticleDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockArticleForUpdate(tx, id)
    if (!locked) throw notFound()
    if (!locked.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该文章未被删除，无需恢复")
    if (version !== locked.version) throw versionConflict()

    // 整改问题 02：恢复同样锁定读分类行（分类被并发删除/停用时结果确定）
    const cat = await lockArticleCategoryBriefForUpdate(asExecutor(tx), locked.categoryId.toString())
    if (!cat || cat.deletedAt) throw restoreBlocked("所属分类不存在或已被删除，无法恢复（请先处理分类）")
    if (locked.status === "published" && cat.status !== "active") {
      throw restoreBlocked("所属分类处于停用状态，恢复后文章将不可见，请先启用该分类")
    }

    const ok = await repo.restoreArticle(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getArticleDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "article.restore",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: locked.deletedAt },
      after: { title: record.title, status: record.status, deleted_at: null },
    })
    return { data: record }
  })
}
