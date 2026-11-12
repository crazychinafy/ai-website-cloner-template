// P6D：线路管理 Service（site_lines）
// ─────────────────────────────────────────────────────────────────
// 领域规则（§6）：
// - POST 恒 disabled（新建需管理员确认后启用）、version=1；sortOrder 省略 = 追加末尾
// - PATCH 无 status；启停独立接口（active ↔ disabled；同态 → 422）
// - reorder：单事务 + 固定锁顺序（按 ID 升序一次锁定）+ 逐行版本；线路全局一个排序范围
// - 软删除行对 update/status/delete 一律 404；恢复保留原 name/url/status/排序
// - URL 只做格式校验（httpUrlSchema）；服务端绝不访问外部地址（§6.7，可达性由前台探测）
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { auditUrl } from "../audit/url-audit.ts"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import * as repo from "../repositories/line-repository.ts"
import { asExecutor } from "../repositories/executor.ts"
import type { LineDto, LineStatus } from "../dto/line.ts"
import { pageResult } from "../dto/content.ts"
import type { CreateLineInput, LineListQuery, LineStatusChangeInput, ReorderLinesInput, UpdateLineInput } from "../validation/line-schema.ts"

const RT = "line"

function notFound(): ContentError {
  return new ContentError(404, "LINE_NOT_FOUND", "线路不存在或已被删除")
}
function transitionBlocked(reason: string): ContentError {
  return new ContentError(422, "LINE_STATUS_TRANSITION", reason)
}

const STATUS_LABEL: Record<LineStatus, string> = { active: "启用", disabled: "停用" }

// ── 读 ───────────────────────────────────────────────────────────

export async function listLines(q: LineListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await repo.listLines(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getLine(id: string, db: AdminDb = getDrizzle()) {
  const dto = await repo.getLineDto(asExecutor(db), id)
  if (!dto) throw notFound()
  return { data: dto }
}

// ── 新建（恒 disabled / version=1）───────────────────────────────

export async function createLine(ctx: WriteCtx, input: CreateLineInput, db: AdminDb = getDrizzle()): Promise<{ data: LineDto }> {
  const sortOrder = input.sortOrder ?? (await repo.maxSortOrderActive(asExecutor(db))) + 1

  return db.transaction(async (tx) => {
    const id = await repo.insertLine(tx, { name: input.name, url: input.url, sortOrder })
    await writeAudit(tx, ctx, {
      action: "line.create",
      resourceType: RT,
      resourceId: id,
      after: { name: input.name, url: auditUrl(input.url), status: "disabled", sort_order: sortOrder },
    })
    const record = await repo.getLineDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 编辑（PATCH；无 status）─────────────────────────────────────

export async function updateLine(ctx: WriteCtx, id: string, input: UpdateLineInput, db: AdminDb = getDrizzle()): Promise<{ data: LineDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockLineForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()

    const patch: repo.LinePatch = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.url !== undefined) patch.url = input.url
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

    const ok = await repo.updateLineWithVersion(tx, id, locked.version, patch)
    if (!ok) throw versionConflict()

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.name !== undefined && input.name !== locked.name) {
      before.name = locked.name
      after.name = input.name
    }
    if (input.url !== undefined && input.url !== locked.url) {
      before.url = auditUrl(locked.url)
      after.url = auditUrl(input.url)
    }
    if (input.sortOrder !== undefined && input.sortOrder !== locked.sortOrder) {
      before.sort_order = locked.sortOrder
      after.sort_order = input.sortOrder
    }
    await writeAudit(tx, ctx, { action: "line.update", resourceType: RT, resourceId: id, before, after })

    const record = await repo.getLineDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 启停（lines.update；line.enable / line.disable）─────────────

export async function changeLineStatus(
  ctx: WriteCtx,
  id: string,
  input: LineStatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LineDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockLineForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()
    if (locked.status === input.status) throw transitionBlocked(`线路已处于${STATUS_LABEL[input.status]}状态`)

    const ok = await repo.setLineStatusWithVersion(tx, id, locked.version, input.status)
    if (!ok) throw versionConflict()

    await writeAudit(tx, ctx, {
      action: input.status === "active" ? "line.enable" : "line.disable",
      resourceType: RT,
      resourceId: id,
      before: { status: locked.status, name: locked.name },
      after: { status: input.status },
    })
    const record = await repo.getLineDto(asExecutor(tx), id)
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 批量排序（全局作用域；固定锁顺序；任一失败整批回滚）──────────

export async function reorderLines(
  ctx: WriteCtx,
  input: ReorderLinesInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: LineDto[] } }> {
  return db.transaction(async (tx) => {
    // 固定锁顺序：按 ID 升序一次锁定全部行（避免相反提交顺序死锁，§6.5）
    const sortedIds = [...input.items].map((i) => i.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
    const rows = await repo.lockLinesForUpdate(tx, sortedIds)
    const byId = new Map(rows.map((r) => [r.id.toString(), r]))

    for (const item of input.items) {
      const row = byId.get(item.id)
      if (!row || row.deletedAt) throw notFound()
      if (row.version !== item.version) throw versionConflict()
    }

    const beforeItems = input.items.map((i) => ({ id: i.id, sort_order: byId.get(i.id)!.sortOrder }))
    for (const item of input.items) {
      const ok = await repo.setLineSortOrderWithVersion(tx, item.id, item.version, item.sortOrder)
      if (!ok) throw versionConflict()
    }

    const records: LineDto[] = []
    for (const item of input.items) {
      const r = await repo.getLineDto(asExecutor(tx), item.id)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "line.reorder",
      resourceType: RT,
      resourceId: "global",
      before: { items: beforeItems },
      after: { items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })) },
    })
    return { data: { records } }
  })
}

// ── 软删除 / 恢复 ────────────────────────────────────────────────

export async function deleteLine(ctx: WriteCtx, id: string, version: number, db: AdminDb = getDrizzle()): Promise<{ data: LineDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockLineForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.softDeleteLine(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getLineDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "line.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { name: locked.name, status: locked.status, deleted_at: null },
      after: { name: record.name, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreLineRecord(ctx: WriteCtx, id: string, version: number, db: AdminDb = getDrizzle()): Promise<{ data: LineDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockLineForUpdate(tx, id)
    if (!locked) throw notFound()
    if (!locked.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该线路未被删除，无需恢复")
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.restoreLine(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getLineDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "line.restore",
      resourceType: RT,
      resourceId: id,
      before: { name: locked.name, status: locked.status, deleted_at: locked.deletedAt },
      after: { name: record.name, status: record.status, deleted_at: null },
    })
    return { data: record }
  })
}
