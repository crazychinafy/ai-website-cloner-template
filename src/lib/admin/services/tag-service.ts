// P6A：标签 Service（site_tags；颜色/图标预览数据的写入规则 + 删除保护）
// 删除保护：使用中的标签（含软删除网址引用）→ 拒绝。全局排序。
import "server-only"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import type { WriteCtx } from "../audit/audit-writer.ts"
import { writeAudit } from "../audit/audit-writer.ts"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { asExecutor } from "../repositories/executor.ts"
import * as repo from "../repositories/tag-repository.ts"
import type { CreateTagInput, ReorderTagsInput, TagListQuery, UpdateTagInput } from "../validation/tag-schema.ts"
import type { StatusChangeInput } from "./category-service.ts"
import type { TagDto } from "../dto/content.ts"
import { pageResult } from "../dto/content.ts"

const RT = "tag"

export async function listTags(q: TagListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await repo.listTags(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getTag(id: string, db: AdminDb = getDrizzle()) {
  const row = await repo.getTagById(asExecutor(db), id)
  if (!row) throw notFound()
  return { data: row }
}

export async function createTag(ctx: WriteCtx, input: CreateTagInput, db: AdminDb = getDrizzle()): Promise<{ data: TagDto }> {
  return db.transaction(async (tx) => {
    const conflict = await repo.findTagNameConflict(asExecutor(tx), input.name)
    if (conflict) throw nameConflict()
    const sortOrder = input.sortOrder ?? (await repo.maxTagSortOrder(asExecutor(tx))) + 1
    const id = await repo.insertTag(tx, {
      name: input.name,
      iconClass: input.iconClass ?? "",
      color: input.color ?? "#000000",
      bgColor: input.bgColor ?? "#ffffff",
      sortOrder,
      status: input.status ?? "active",
    })
    const record = await repo.getTagById(asExecutor(tx), id)
    if (!record) throw new ContentError(500, "INTERNAL_ERROR", "标签创建后读取失败")
    await writeAudit(tx, ctx, {
      action: "tag.create",
      resourceType: RT,
      resourceId: id,
      before: null,
      after: {
        name: record.name,
        icon_class: record.iconClass,
        color: record.color,
        bg_color: record.bgColor,
        sort_order: record.sortOrder,
        status: record.status,
      },
    })
    return { data: record }
  })
}

export async function updateTag(
  ctx: WriteCtx,
  id: string,
  input: UpdateTagInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: TagDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getTagById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()

    const patch: repo.TagPatch = {}
    if (input.name !== undefined) {
      const conflict = await repo.findTagNameConflict(asExecutor(tx), input.name, id)
      if (conflict) throw nameConflict()
      patch.name = input.name
    }
    if (input.iconClass !== undefined) patch.iconClass = input.iconClass
    if (input.color !== undefined) patch.color = input.color
    if (input.bgColor !== undefined) patch.bgColor = input.bgColor
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
    if (input.status !== undefined) patch.status = input.status

    const ok = await repo.updateTagWithVersion(tx, id, input.version, patch)
    if (!ok) throw versionConflict()
    const record = await repo.getTagById(asExecutor(tx), id)
    if (!record) throw notFound()
    const before: Record<string, unknown> = {}
    if (input.name !== undefined) before.name = current.name
    if (input.iconClass !== undefined) before.icon_class = current.iconClass
    if (input.color !== undefined) before.color = current.color
    if (input.bgColor !== undefined) before.bg_color = current.bgColor
    if (input.sortOrder !== undefined) before.sort_order = current.sortOrder
    if (input.status !== undefined) before.status = current.status
    const after: Record<string, unknown> = {}
    if (input.name !== undefined) after.name = input.name
    if (input.iconClass !== undefined) after.icon_class = input.iconClass
    if (input.color !== undefined) after.color = input.color
    if (input.bgColor !== undefined) after.bg_color = input.bgColor
    if (input.sortOrder !== undefined) after.sort_order = input.sortOrder
    if (input.status !== undefined) after.status = input.status
    await writeAudit(tx, ctx, { action: "tag.update", resourceType: RT, resourceId: id, before, after })
    return { data: record }
  })
}

export async function changeTagStatus(
  ctx: WriteCtx,
  id: string,
  input: StatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: TagDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getTagById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()
    const ok = await repo.updateTagWithVersion(tx, id, input.version, { status: input.status })
    if (!ok) throw versionConflict()
    const record = await repo.getTagById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: input.status === "active" ? "tag.enable" : "tag.disable",
      resourceType: RT,
      resourceId: id,
      before: { status: current.status },
      after: { status: input.status },
    })
    return { data: record }
  })
}

export async function reorderTags(
  ctx: WriteCtx,
  input: ReorderTagsInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: TagDto[] } }> {
  return db.transaction(async (tx) => {
    const records: TagDto[] = []
    for (const item of input.items) {
      const row = await repo.getTagById(asExecutor(tx), item.id)
      if (!row || row.deletedAt) throw notFound()
      if (row.version !== item.version) throw versionConflict()
      const ok = await repo.updateTagWithVersion(tx, item.id, item.version, { sortOrder: item.sortOrder })
      if (!ok) throw versionConflict()
    }
    for (const item of input.items) {
      const r = await repo.getTagById(asExecutor(tx), item.id)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "tag.reorder",
      resourceType: RT,
      resourceId: "global",
      before: null,
      after: { items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })) },
    })
    return { data: { records } }
  })
}

export async function deleteTag(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: TagDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getTagById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (version !== current.version) throw versionConflict()
    const counts = await repo.countLinksByTagIds(asExecutor(tx), [id])
    const n = counts.get(id) ?? 0
    if (n > 0) {
      throw new ContentError(409, "TAG_HAS_LINKS", `该标签仍被 ${n} 个网址使用（含已删除），请先解除引用`)
    }
    const ok = await repo.softDeleteTag(tx, id, version)
    if (!ok) throw versionConflict()
    const record = await repo.getTagById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "tag.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: null },
      after: { name: record.name, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreTag(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: TagDto }> {
  return db.transaction(async (tx) => {
    const current = await repo.getTagById(asExecutor(tx), id)
    if (!current) throw notFound()
    if (!current.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该标签未被删除，无需恢复")
    if (version !== current.version) throw versionConflict()
    const ok = await repo.restoreTag(tx, id, version)
    if (!ok) throw versionConflict()
    const record = await repo.getTagById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "tag.restore",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: current.deletedAt },
      after: { name: record.name, deleted_at: null },
    })
    return { data: record }
  })
}

function notFound(): ContentError {
  return new ContentError(404, "TAG_NOT_FOUND", "标签不存在或已被删除")
}

function nameConflict(): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "标签名称已存在", { name: "标签名称已存在" })
}
