// P6D：广告管理 Service（ads）
// ─────────────────────────────────────────────────────────────────
// 领域规则（§5）：
// - POST 恒 draft、version=1；sortOrder 省略 = 追加到同 position 有效行末尾
// - 状态机（DB status）：draft→active|expired；active→disabled|expired；
//   disabled→active|expired；expired→active|disabled；同态 / 非法迁移 → 422
// - effectiveStatus 只在 DTO 计算，GET 绝不回写 DB（§5.3）
// - imagePath 服务端解析：站内静态目录 + 文件存在性 + 符号链接 containment（media-file.ts）
// - targetUrl 仅格式校验：保存/预览均不访问外部地址（§5.9 SSRF 禁令，代码路径无 fetch）
// - reorder：单事务 + 固定锁顺序（按 ID 升序一次锁定）+ 逐行版本 + 同 position 作用域
// - 软删除行对 update/status/delete 一律 404；恢复保留原位置/排序/投放时间/状态
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { auditUrl } from "../audit/url-audit.ts"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import { staticImageError } from "../security/media-file.ts"
import * as repo from "../repositories/ad-repository.ts"
import { asExecutor } from "../repositories/executor.ts"
import type { AdDbStatus, AdDto, AdEffectiveStatus } from "../dto/ad.ts"
import { pageResult } from "../dto/content.ts"
import type { AdListQuery, AdStatusChangeInput, CreateAdInput, ReorderAdsInput, UpdateAdInput } from "../validation/ad-schema.ts"

const RT = "ad"

/** 与 DB 会话一致的本地墙钟（naive DATETIME 直写直读；池 timezone:"Z"、本机同 tz） */
export function wallNowSql(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function notFound(): ContentError {
  return new ContentError(404, "AD_NOT_FOUND", "广告不存在或已被删除")
}
function transitionBlocked(reason: string): ContentError {
  return new ContentError(422, "AD_STATUS_TRANSITION", reason)
}
function fieldError(field: string, message: string): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "请求参数不正确", { [field]: message })
}

const STATUS_LABEL: Record<AdDbStatus, string> = {
  draft: "草稿",
  active: "投放中",
  disabled: "已停用",
  expired: "已过期",
}
const TARGET_LABEL: Record<"active" | "disabled" | "expired", string> = {
  active: "投放中（启用）",
  disabled: "已停用",
  expired: "已过期",
}

// 状态机（§5.3）：draft 可启用；active 可停用；disabled 可重新启用；expired = 明确标记过期
const ALLOWED_TRANSITIONS: Record<AdDbStatus, ReadonlySet<"active" | "disabled" | "expired">> = {
  draft: new Set(["active", "expired"]),
  active: new Set(["disabled", "expired"]),
  disabled: new Set(["active", "expired"]),
  expired: new Set(["active", "disabled"]),
}

/** startsAt < endsAt（§5.4-8）；合并 PATCH 后校验 */
function checkWindow(startsAt: string | null, endsAt: string | null): void {
  if (startsAt !== null && endsAt !== null && startsAt >= endsAt) {
    throw fieldError("startsAt", "投放开始时间必须早于结束时间")
  }
}

// ── 读 ───────────────────────────────────────────────────────────

export async function listAds(q: AdListQuery, db: AdminDb = getDrizzle()) {
  const now = wallNowSql()
  const { items, total } = await repo.listAds(asExecutor(db), q, now)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getAd(id: string, db: AdminDb = getDrizzle()) {
  const dto = await repo.getAdDto(asExecutor(db), id, wallNowSql())
  if (!dto) throw notFound()
  return { data: dto }
}

// ── 新建（恒 draft / version=1）─────────────────────────────────

export async function createAd(ctx: WriteCtx, input: CreateAdInput, db: AdminDb = getDrizzle()): Promise<{ data: AdDto }> {
  const startsAt = input.startsAt ?? null
  const endsAt = input.endsAt ?? null
  checkWindow(startsAt, endsAt)

  const imgErr = await staticImageError(input.imagePath, "广告图片")
  if (imgErr) throw fieldError("imagePath", imgErr)

  const sortOrder = input.sortOrder ?? (await repo.maxSortOrderActiveByPosition(asExecutor(db), input.position)) + 1

  return db.transaction(async (tx) => {
    const id = await repo.insertAd(tx, {
      position: input.position,
      title: input.title,
      targetUrl: input.targetUrl,
      imagePath: input.imagePath,
      sortOrder,
      startsAt,
      endsAt,
    })
    await writeAudit(tx, ctx, {
      action: "ad.create",
      resourceType: RT,
      resourceId: id,
      after: {
        title: input.title,
        position: input.position,
        target_url: auditUrl(input.targetUrl),
        image_path: input.imagePath,
        status: "draft",
        sort_order: sortOrder,
        starts_at: startsAt,
        ends_at: endsAt,
      },
    })
    const record = await repo.getAdDto(asExecutor(tx), id, wallNowSql())
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 编辑（PATCH；无 status）─────────────────────────────────────

export async function updateAd(ctx: WriteCtx, id: string, input: UpdateAdInput, db: AdminDb = getDrizzle()): Promise<{ data: AdDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockAdForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()

    const startsAt = input.startsAt !== undefined ? input.startsAt : (locked.startsAt ?? null)
    const endsAt = input.endsAt !== undefined ? input.endsAt : (locked.endsAt ?? null)
    checkWindow(startsAt, endsAt)

    if (input.imagePath !== undefined && input.imagePath !== locked.imagePath) {
      const imgErr = await staticImageError(input.imagePath, "广告图片")
      if (imgErr) throw fieldError("imagePath", imgErr)
    }

    const patch: repo.AdPatch = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.position !== undefined) patch.position = input.position
    if (input.targetUrl !== undefined) patch.targetUrl = input.targetUrl
    if (input.imagePath !== undefined) patch.imagePath = input.imagePath
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt
    if (input.endsAt !== undefined) patch.endsAt = input.endsAt

    const ok = await repo.updateAdWithVersion(tx, id, locked.version, patch)
    if (!ok) throw versionConflict()

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.title !== undefined && input.title !== locked.title) {
      before.title = locked.title
      after.title = input.title
    }
    if (input.position !== undefined && input.position !== locked.position) {
      before.position = locked.position
      after.position = input.position
    }
    if (input.targetUrl !== undefined && input.targetUrl !== locked.targetUrl) {
      before.target_url = auditUrl(locked.targetUrl)
      after.target_url = auditUrl(input.targetUrl)
    }
    if (input.imagePath !== undefined && input.imagePath !== locked.imagePath) {
      before.image_path = locked.imagePath
      after.image_path = input.imagePath
    }
    if (input.sortOrder !== undefined && input.sortOrder !== locked.sortOrder) {
      before.sort_order = locked.sortOrder
      after.sort_order = input.sortOrder
    }
    if (input.startsAt !== undefined && input.startsAt !== (locked.startsAt ?? null)) {
      before.starts_at = locked.startsAt ?? null
      after.starts_at = input.startsAt
    }
    if (input.endsAt !== undefined && input.endsAt !== (locked.endsAt ?? null)) {
      before.ends_at = locked.endsAt ?? null
      after.ends_at = input.endsAt
    }
    await writeAudit(tx, ctx, { action: "ad.update", resourceType: RT, resourceId: id, before, after })

    const record = await repo.getAdDto(asExecutor(tx), id, wallNowSql())
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 状态切换（ads.update；ad.enable / ad.disable / ad.expire）────

export async function changeAdStatus(
  ctx: WriteCtx,
  id: string,
  input: AdStatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: AdDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockAdForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()
    if (locked.status === input.status) throw transitionBlocked(`广告已处于${TARGET_LABEL[input.status]}状态`)
    if (!ALLOWED_TRANSITIONS[locked.status].has(input.status)) {
      throw transitionBlocked(`不允许从${STATUS_LABEL[locked.status]}变更为${TARGET_LABEL[input.status]}`)
    }

    const ok = await repo.setAdStatusWithVersion(tx, id, locked.version, input.status)
    if (!ok) throw versionConflict()

    const action = input.status === "active" ? "ad.enable" : input.status === "disabled" ? "ad.disable" : "ad.expire"
    await writeAudit(tx, ctx, {
      action,
      resourceType: RT,
      resourceId: id,
      before: { status: locked.status, title: locked.title },
      after: { status: input.status },
    })
    const record = await repo.getAdDto(asExecutor(tx), id, wallNowSql())
    if (!record) throw notFound()
    return { data: record }
  })
}

// ── 批量排序（同 position 作用域；固定锁顺序；任一失败整批回滚）──

export async function reorderAds(
  ctx: WriteCtx,
  input: ReorderAdsInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: AdDto[] } }> {
  return db.transaction(async (tx) => {
    // 固定锁顺序：按 ID 升序一次锁定全部行（避免相反提交顺序死锁，§5.6）
    const sortedIds = [...input.items].map((i) => i.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
    const rows = await repo.lockAdsForUpdate(tx, sortedIds)
    const byId = new Map(rows.map((r) => [r.id.toString(), r]))

    const position = input.position ?? null
    let scopePosition: string | null = position
    for (const item of input.items) {
      const row = byId.get(item.id)
      if (!row || row.deletedAt) throw notFound()
      if (scopePosition === null) scopePosition = row.position
      else if (row.position !== scopePosition) {
        throw new ContentError(409, "REORDER_SCOPE_MISMATCH", "批量排序必须在同一广告位置（position）内进行")
      }
      if (row.version !== item.version) throw versionConflict()
    }
    if (scopePosition === null) throw notFound()

    const beforeItems = input.items.map((i) => ({ id: i.id, sort_order: byId.get(i.id)!.sortOrder }))
    for (const item of input.items) {
      const ok = await repo.setAdSortOrderWithVersion(tx, item.id, item.version, item.sortOrder)
      if (!ok) throw versionConflict()
    }

    const now = wallNowSql()
    const records: AdDto[] = []
    for (const item of input.items) {
      const r = await repo.getAdDto(asExecutor(tx), item.id, now)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "ad.reorder",
      resourceType: RT,
      resourceId: `position:${scopePosition}`,
      before: { items: beforeItems },
      after: { items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })) },
    })
    return { data: { records } }
  })
}

// ── 软删除 / 恢复 ────────────────────────────────────────────────

export async function deleteAd(ctx: WriteCtx, id: string, version: number, db: AdminDb = getDrizzle()): Promise<{ data: AdDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockAdForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.softDeleteAd(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getAdDto(asExecutor(tx), id, wallNowSql())
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "ad.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: null },
      after: { title: record.title, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreAdRecord(ctx: WriteCtx, id: string, version: number, db: AdminDb = getDrizzle()): Promise<{ data: AdDto }> {
  return db.transaction(async (tx) => {
    const locked = await repo.lockAdForUpdate(tx, id)
    if (!locked) throw notFound()
    if (!locked.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该广告未被删除，无需恢复")
    if (version !== locked.version) throw versionConflict()

    const ok = await repo.restoreAd(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await repo.getAdDto(asExecutor(tx), id, wallNowSql())
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "ad.restore",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, position: locked.position, deleted_at: locked.deletedAt },
      after: { title: record.title, status: record.status, position: record.position, deleted_at: null },
    })
    return { data: record }
  })
}

export type { AdEffectiveStatus }
