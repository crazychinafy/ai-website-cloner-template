// P6C：公告管理 Service（bulletins）
// ─────────────────────────────────────────────────────────────────
// 与 article-service 同一纪律（单事务 + 乐观锁 + 同事务审计 + 正文净化）。
// 领域规则：
// - POST 恒 draft；sortOrder 省略 = 追加到有效行末尾（max+1）
// - 状态机与文章一致：published→draft（撤回）禁止；published_at 首发写一次
// - reorder：单事务逐行锁 + 逐行版本；任一失败整批回滚；审计记 before/after 排序表
// - 软删除行对 update/status/delete 一律 404；恢复保留原状态（无外部依赖）
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import { sanitizeRichHtml, htmlDigest } from "../security/html-sanitizer.ts"
import * as repo from "../repositories/bulletin-repository.ts"
import { asExecutor } from "../repositories/executor.ts"
import type { BulletinDto, BulletinPreviewDto } from "../dto/bulletin.ts"
import { pageResult } from "../dto/bulletin.ts"
import type {
  BulletinListQuery,
  BulletinPreviewInput,
  BulletinStatus,
  BulletinStatusChangeInput,
  CreateBulletinInput,
  ReorderBulletinsInput,
  UpdateBulletinInput,
} from "../validation/bulletin-schema.ts"

const RT = "bulletin"

function notFound(): ContentError {
  return new ContentError(404, "BULLETIN_NOT_FOUND", "公告不存在或已被删除")
}
function transitionBlocked(reason: string): ContentError {
  return new ContentError(422, "BULLETIN_STATUS_TRANSITION", reason)
}

// 状态机与文章一致（§P6C）
const ALLOWED_TRANSITIONS: Record<BulletinStatus, ReadonlySet<BulletinStatus>> = {
  draft: new Set(["published", "archived"]),
  published: new Set(["archived"]),
  archived: new Set(["published"]),
}

function statusLabel(s: BulletinStatus): string {
  return s === "draft" ? "草稿" : s === "published" ? "已发布" : "已归档"
}

// ── 读 ───────────────────────────────────────────────────────────

export async function listBulletins(q: BulletinListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await repo.listBulletins(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getBulletin(id: string, db: AdminDb = getDrizzle()) {
  const dto = await repo.getBulletinDto(asExecutor(db), id)
  if (!dto) throw notFound()
  return { data: dto }
}

/** 预览（不落库不审计；与文章预览同构） */
export function previewBulletin(input: BulletinPreviewInput): { data: BulletinPreviewDto } {
  return { data: { html: sanitizeRichHtml(input.contentHtml), title: input.title ?? "" } }
}

// ── 新建（恒 draft）──────────────────────────────────────────────

export async function createBulletin(
  ctx: WriteCtx,
  input: CreateBulletinInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: BulletinDto }> {
  const sortOrder = input.sortOrder ?? (await repo.maxSortOrderActive(asExecutor(db))) + 1
  const contentHtml = sanitizeRichHtml(input.contentHtml ?? "")

  return db.transaction(async (tx) => {
    const id = await repo.insertBulletin(tx, { title: input.title, contentHtml, sortOrder })
    await writeAudit(tx, ctx, {
      action: "bulletin.create",
      resourceType: RT,
      resourceId: id,
      after: { title: input.title, status: "draft", sortOrder, contentHtml: htmlDigest(contentHtml) },
    })
    const record = await repo.getBulletinDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 编辑（PATCH；无 status）──────────────────────────────────────

export async function updateBulletin(
  ctx: WriteCtx,
  id: string,
  input: UpdateBulletinInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: BulletinDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockBulletinForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()

    const sanitizedBody = input.contentHtml !== undefined ? sanitizeRichHtml(input.contentHtml) : undefined
    const patch: repo.BulletinPatch = {}
    if (input.title !== undefined) patch.title = input.title
    if (sanitizedBody !== undefined) patch.contentHtml = sanitizedBody
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

    const ok = await repo.updateBulletinWithVersion(tx, id, locked.version, patch)
    if (!ok) throw versionConflict()

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.title !== undefined) {
      before.title = locked.title
      after.title = input.title
    }
    if (input.sortOrder !== undefined) {
      before.sortOrder = locked.sortOrder
      after.sortOrder = input.sortOrder
    }
    if (sanitizedBody !== undefined && sanitizedBody !== locked.contentHtml) {
      before.contentHtml = htmlDigest(locked.contentHtml)
      after.contentHtml = htmlDigest(sanitizedBody)
    }
    await writeAudit(tx, ctx, { action: "bulletin.update", resourceType: RT, resourceId: id, before, after })

    const record = await repo.getBulletinDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 状态切换（bulletins.publish；发布要求正文非空）──────────────

export async function changeBulletinStatus(
  ctx: WriteCtx,
  id: string,
  input: BulletinStatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: BulletinDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockBulletinForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()
    if (locked.status === input.status) throw transitionBlocked(`公告已处于${statusLabel(input.status)}状态`)
    if (!ALLOWED_TRANSITIONS[locked.status].has(input.status)) {
      throw transitionBlocked(`不允许从${statusLabel(locked.status)}变更为${statusLabel(input.status)}（已归档的公告可直接再发布）`)
    }

    let sanitizedBody: string | undefined
    if (input.status === "published") {
      const sanitized = sanitizeRichHtml(locked.contentHtml)
      if (sanitized.trim() === "") throw transitionBlocked("正文为空，不能发布")
      if (sanitized !== locked.contentHtml) sanitizedBody = sanitized
    }

    const ok = await repo.setBulletinStatusWithVersion(tx, id, locked.version, input.status, {
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
      action: input.status === "published" ? "bulletin.publish" : "bulletin.archive",
      resourceType: RT,
      resourceId: id,
      before,
      after,
    })
    const record = await repo.getBulletinDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 批量排序（单事务；任一冲突整批回滚；§P6C）───────────────────

export async function reorderBulletins(
  ctx: WriteCtx,
  input: ReorderBulletinsInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: BulletinDto[] } }> {
  return db.transaction(async (tx) => {
    const beforeItems: { id: string; sort_order: number }[] = []
    for (const item of input.items) {
      const locked = await repo.lockBulletinForUpdate(tx, item.id)
      if (!locked || locked.deletedAt) throw notFound()
      if (locked.version !== item.version) throw versionConflict()
      beforeItems.push({ id: item.id, sort_order: locked.sortOrder })
      const ok = await repo.setBulletinSortOrderWithVersion(tx, item.id, item.version, item.sortOrder)
      if (!ok) throw versionConflict()
    }
    const records: BulletinDto[] = []
    for (const item of input.items) {
      const r = await repo.getBulletinDto(asExecutor(tx), item.id)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "bulletin.reorder",
      resourceType: RT,
      resourceId: "global",
      before: { items: beforeItems },
      after: { items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })) },
    })
    return { data: { records } }
  })
}

// ── 软删除 / 恢复 ────────────────────────────────────────────────

export async function deleteBulletin(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: BulletinDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockBulletinForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.softDeleteBulletin(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getBulletinDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "bulletin.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: null },
      after: { title: record.title, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreBulletin(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: BulletinDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockBulletinForUpdate(tx, id)
    if (!locked) throw notFound()
    if (!locked.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该公告未被删除，无需恢复")
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.restoreBulletin(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getBulletinDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "bulletin.restore",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: locked.deletedAt },
      after: { title: record.title, status: record.status, deleted_at: null },
    })
    return { data: record }
  })
}
