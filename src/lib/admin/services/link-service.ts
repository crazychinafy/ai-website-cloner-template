// P6B：网址管理 Service（site_links 聚合：主行 + 详情 1:1 + 备用链接 1:N）
// ─────────────────────────────────────────────────────────────────
// 架构与 category/tag service 完全一致：
//   Route → handleWrite（认证+RBAC+CSRF）→ Zod → 本 Service → Repository → Drizzle
//   每个写操作单事务（db.transaction）、乐观锁 version、同事务写审计（writeAudit）
// 聚合写合同：
//   - PATCH 主行字段；detail 省略=不改 / null=删除详情行 / 对象=upsert（部分字段）
//   - mirrors 数组=全量替换（服务端按数组序重排 sortOrder；已有 ID 必须属于本网址）
//   - 聚合任一子表变化都 bump 主行 version（表单刷新合同统一）
//   - 普通 PATCH 无 status 字段：发布/下架走 PATCH /status（links.publish 权限 + 状态机）
//   - 详情 HTML 服务端净化后入库（html-sanitize）；URL/Logo 协议校验在 Zod（不抓取远端，SSRF 面收敛）
// 锁序与错误语义对齐 P6A：先锁 site_links 自身行（lockLinkForUpdate）再做规则检查；
// 软删除行对 update/status/delete 一律 404「不存在或已被删除」（与分类一致）；
// 恢复到未删除行 422；分类/标签缺失的恢复 409 LINK_RESTORE_BLOCKED。
// 标签停用与发布的窄竞态以「提交时刻校验」为准（管理员后台低频写，接受该 TOCTOU，审计可回溯）。
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import type { WriteCtx } from "../audit/audit-writer.ts"
import { writeAudit } from "../audit/audit-writer.ts"
import { ContentError } from "../validation/content-error.ts"
import * as linkRepo from "../repositories/link-repository.ts"
import * as catRepo from "../repositories/category-repository.ts"
import { getTagById } from "../repositories/tag-repository.ts"
import { asExecutor, type AdminTx, type Executor } from "../repositories/executor.ts"
import { sanitizeDetailHtml } from "../validation/html-sanitize.ts"
import type { LinkAggregateDto, LinkDto, LinkMirrorDto } from "../dto/link.ts"
import { pageResult } from "../dto/link.ts"
import type {
  CreateLinkInput,
  LinkDetailInput,
  LinkListQuery,
  LinkMirrorInput,
  LinkStatus,
  LinkStatusChangeInput,
  UpdateLinkInput,
} from "../validation/link-schema.ts"

const RT = "link"

// ── 错误工厂（统一信封，SQL/堆栈不透出）──────────────────────────

function notFound(): ContentError {
  return new ContentError(404, "LINK_NOT_FOUND", "网址不存在或已被删除")
}
function versionConflict(): ContentError {
  return new ContentError(409, "VERSION_CONFLICT", "该记录已被其他管理员修改，请刷新后重新编辑")
}
function transitionBlocked(reason: string): ContentError {
  return new ContentError(422, "LINK_STATUS_TRANSITION", reason)
}
function catMissing(): ContentError {
  return new ContentError(409, "VALIDATION_ERROR", "所属分类不存在（可能已被删除），请重新指定分类")
}
function catDisabled(): ContentError {
  return new ContentError(409, "VALIDATION_ERROR", "所属分类处于停用状态，请先启用该分类")
}
function tagMissing(): ContentError {
  return new ContentError(409, "VALIDATION_ERROR", "关联标签不存在（可能已被删除），请重新指定标签")
}
function tagDisabled(): ContentError {
  return new ContentError(409, "TAG_NOT_USABLE", "关联标签处于停用状态，请先启用该标签")
}
function mirrorMismatch(): ContentError {
  return new ContentError(409, "LINK_MIRROR_MISMATCH", "备用链接不属于本网址（可能已被其他管理员删除），请刷新后重试")
}
function mirrorDuplicate(): ContentError {
  return new ContentError(409, "LINK_MIRROR_DUPLICATE", "备用链接 ID 重复，请刷新后重试")
}

// ── 状态机（§P6B：草稿 / 发布 / 停用；非法转换 422）──────────────
//   draft ──publish──▶ published ◀──发布──────────── disabled
//     │                    │                           ▲
//     └──────disable────────┴──────────disable─────────┘
//   published ──▶ draft（撤回）；disabled ──▶ draft：禁止（要回草稿直接编辑，再发布）

const ALLOWED_TRANSITIONS: Record<LinkStatus, ReadonlySet<LinkStatus>> = {
  draft: new Set(["published", "disabled"]),
  published: new Set(["disabled", "draft"]),
  disabled: new Set(["published"]),
}

function statusLabel(s: LinkStatus): string {
  return s === "draft" ? "草稿" : s === "published" ? "已发布" : "已停用"
}

/** 发布前置校验：分类存在未删且 active；标签（若有）存在未删且 active */
async function assertPublishable(exec: Executor, categoryId: string, tagId: string | null): Promise<void> {
  const cat = await catRepo.getCategoryById(exec, categoryId)
  if (!cat || cat.deletedAt) throw catMissing()
  if (cat.status !== "active") throw catDisabled()
  if (tagId) {
    const tag = await getTagById(exec, tagId)
    if (!tag || tag.deletedAt) throw tagMissing()
    if (tag.status !== "active") throw tagDisabled()
  }
}

/** 分类/标签「关联」校验（编辑/新建允许关联停用项；发布才要求 active） */
async function assertRefsExist(exec: Executor, categoryId: string, tagId: string | null): Promise<void> {
  const cat = await catRepo.getCategoryById(exec, categoryId)
  if (!cat || cat.deletedAt) throw catMissing()
  if (tagId) {
    const tag = await getTagById(exec, tagId)
    if (!tag || tag.deletedAt) throw tagMissing()
  }
}

// ── 读 ───────────────────────────────────────────────────────────

export async function listLinks(q: LinkListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await linkRepo.listLinks(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getLink(id: string, db: AdminDb = getDrizzle()) {
  return { data: await loadAggregate(asExecutor(db), id) }
}

async function loadAggregate(exec: Executor, id: string): Promise<LinkAggregateDto> {
  const dto = await linkRepo.getLinkDto(exec, id)
  if (!dto) throw notFound()
  return { ...dto, detail: await linkRepo.getLinkDetail(exec, id), mirrors: await linkRepo.listMirrors(exec, id) }
}

// ── 新建（恒 draft；sourceSnapshot=false；ID 由 AUTO_INCREMENT 生成）──

export async function createLink(
  ctx: WriteCtx,
  input: CreateLinkInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LinkAggregateDto }> {
  await assertRefsExist(asExecutor(db), input.categoryId, input.tagId ?? null)
  const sortOrder = input.sortOrder ?? (await linkRepo.maxSortOrderAll(asExecutor(db))) + 1

  return db.transaction(async (tx) => {
    const id = await linkRepo.insertLink(tx, {
      title: input.title,
      url: input.url,
      description: input.description ?? "",
      logoPath: input.logoPath ?? "",
      categoryId: input.categoryId,
      tagId: input.tagId ?? null,
      sortOrder,
    })

    if (input.detail) {
      await linkRepo.upsertDetail(tx, id, {
        annotation: input.detail.annotation ?? "",
        previewImage: input.detail.previewImage ?? "",
        detailHtml: input.detail.detailHtml !== undefined ? sanitizeDetailHtml(input.detail.detailHtml) : undefined,
        clickCount: input.detail.clickCount ?? 0,
        likeCount: input.detail.likeCount ?? 0,
      })
    }
    if (input.mirrors && input.mirrors.length > 0) {
      await applyMirrorOps(tx, id, [], input.mirrors)
    }
    // 子表与主行同事务创建，version 保持 1（表单首次编辑即用 version=1）

    const after = await linkRepo.lockLinkForUpdate(tx, id)
    if (!after) throw notFound()
    const afterData: Record<string, unknown> = {
      title: after.title,
      url: after.url,
      categoryId: after.categoryId,
      tagId: after.tagId,
      status: after.status,
      sortOrder: after.sortOrder,
    }
    if (input.detail) afterData.detail = { fields: detailFieldNames(input.detail) }
    if (input.mirrors) afterData.mirrorCount = input.mirrors.length
    await writeAudit(tx, ctx, {
      action: "link.create",
      resourceType: RT,
      resourceId: id,
      after: afterData,
    })
    return { data: await loadAggregate(asExecutor(tx), id) }
  })
}

// ── 编辑（聚合 PATCH）────────────────────────────────────────────

export async function updateLink(
  ctx: WriteCtx,
  id: string,
  input: UpdateLinkInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LinkAggregateDto }> {
  return db.transaction(async (tx) => {
    const locked = await linkRepo.lockLinkForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()

    if (input.categoryId !== undefined || input.tagId !== undefined) {
      await assertRefsExist(asExecutor(tx), input.categoryId ?? locked.categoryId, input.tagId === undefined ? locked.tagId : input.tagId)
    }

    // 主行 patch
    const patch: linkRepo.LinkPatch = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.url !== undefined) patch.url = input.url
    if (input.description !== undefined) patch.description = input.description
    if (input.logoPath !== undefined) patch.logoPath = input.logoPath
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId
    if (input.tagId !== undefined) patch.tagId = input.tagId
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder

    // 备用链接全量替换：先校验归属再动笔（任一非法 ID → 整笔 409，无半态）
    let existingMirrors: LinkMirrorDto[] = []
    if (input.mirrors !== undefined) {
      existingMirrors = await linkRepo.listMirrors(asExecutor(tx), id)
      const providedIds = input.mirrors.filter((m) => m.id !== undefined).map((m) => m.id as string)
      if (new Set(providedIds).size !== providedIds.length) throw mirrorDuplicate()
      if (providedIds.length > 0) {
        const owners = await linkRepo.getMirrorOwners(asExecutor(tx), providedIds)
        for (const mid of providedIds) {
          if (owners.get(mid) !== id) throw mirrorMismatch()
        }
      }
    }

    const anyField = Object.keys(patch).length > 0
    const aggregateTouched = input.detail !== undefined || input.mirrors !== undefined
    if (anyField || aggregateTouched) {
      // 只动子表也要 bump 主行 version（空 patch = 仅 bump）
      const ok = await linkRepo.updateLinkWithVersion(tx, id, locked.version, patch)
      if (!ok) throw versionConflict()
    }

    if (input.detail === null) {
      await linkRepo.deleteDetail(tx, id)
    } else if (input.detail) {
      await linkRepo.upsertDetail(tx, id, {
        annotation: input.detail.annotation,
        previewImage: input.detail.previewImage,
        detailHtml: input.detail.detailHtml !== undefined ? sanitizeDetailHtml(input.detail.detailHtml) : undefined,
        clickCount: input.detail.clickCount,
        likeCount: input.detail.likeCount,
      })
    }
    if (input.mirrors !== undefined) {
      await applyMirrorOps(tx, id, existingMirrors, input.mirrors)
    }

    // 审计 diff：标量字段记新旧值；详情只记字段名（HTML 正文可达 20KB，审计表不存全文）
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.title !== undefined) {
      before.title = locked.title
      after.title = input.title
    }
    if (input.url !== undefined) {
      before.url = locked.url
      after.url = input.url
    }
    if (input.description !== undefined) {
      before.description = locked.description
      after.description = input.description
    }
    if (input.logoPath !== undefined) {
      before.logoPath = locked.logoPath
      after.logoPath = input.logoPath
    }
    if (input.categoryId !== undefined) {
      before.categoryId = locked.categoryId
      after.categoryId = input.categoryId
    }
    if (input.tagId !== undefined) {
      before.tagId = locked.tagId
      after.tagId = input.tagId
    }
    if (input.sortOrder !== undefined) {
      before.sortOrder = locked.sortOrder
      after.sortOrder = input.sortOrder
    }
    if (input.detail === null) after.detail = null
    else if (input.detail) after.detail = { fields: detailFieldNames(input.detail) }
    if (input.mirrors !== undefined) {
      before.mirrorCount = existingMirrors.length
      after.mirrorCount = input.mirrors.length
    }

    await writeAudit(tx, ctx, {
      action: "link.update",
      resourceType: RT,
      resourceId: id,
      before,
      after,
    })
    return { data: await loadAggregate(asExecutor(tx), id) }
  })
}

function detailFieldNames(d: LinkDetailInput): string[] {
  const names: string[] = []
  if (d.annotation !== undefined) names.push("annotation")
  if (d.previewImage !== undefined) names.push("previewImage")
  if (d.detailHtml !== undefined) names.push("detailHtml")
  if (d.clickCount !== undefined) names.push("clickCount")
  if (d.likeCount !== undefined) names.push("likeCount")
  return names
}

// ── 备用链接全量替换（数组顺序即 sortOrder；未提供 ID = 新建）────

async function applyMirrorOps(tx: AdminTx, linkId: string, existing: LinkMirrorDto[], submitted: LinkMirrorInput[]): Promise<void> {
  const keptIds = new Set(submitted.filter((m) => m.id !== undefined).map((m) => m.id as string))
  const deleteIds = existing.filter((e) => !keptIds.has(e.id)).map((e) => e.id)
  await linkRepo.deleteMirrorsByIds(tx, linkId, deleteIds)
  let nextSort = 0
  for (const m of submitted) {
    const sortOrder = nextSort++
    if (m.id !== undefined) await linkRepo.updateMirror(tx, m.id, linkId, { name: m.name, url: m.url, sortOrder })
    else await linkRepo.insertMirror(tx, linkId, { name: m.name, url: m.url, sortOrder })
  }
}

// ── 状态切换（links.publish；状态机 + 发布前置校验）──────────────

export async function changeLinkStatus(
  ctx: WriteCtx,
  id: string,
  input: LinkStatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LinkDto }> {
  return db.transaction(async (tx) => {
    const locked = await linkRepo.lockLinkForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (input.version !== locked.version) throw versionConflict()
    if (locked.status === input.status) throw transitionBlocked(`网址已处于${statusLabel(input.status)}状态`)
    if (!ALLOWED_TRANSITIONS[locked.status].has(input.status)) {
      throw transitionBlocked(`不允许从${statusLabel(locked.status)}变更为${statusLabel(input.status)}（停用后可直接发布）`)
    }
    if (input.status === "published") await assertPublishable(asExecutor(tx), locked.categoryId, locked.tagId)

    const ok = await linkRepo.setLinkStatusWithVersion(tx, id, locked.version, input.status)
    if (!ok) throw versionConflict()

    await writeAudit(tx, ctx, {
      action: input.status === "published" ? "link.publish" : input.status === "disabled" ? "link.disable" : "link.unpublish",
      resourceType: RT,
      resourceId: id,
      before: { status: locked.status, title: locked.title },
      after: { status: input.status },
    })
    const dto = await linkRepo.getLinkDto(asExecutor(tx), id)
    if (!dto) throw notFound()
    return { data: dto }
  })
}

// ── 软删除 / 恢复 ────────────────────────────────────────────────

export async function deleteLink(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LinkDto }> {
  return db.transaction(async (tx) => {
    const locked = await linkRepo.lockLinkForUpdate(tx, id)
    if (!locked || locked.deletedAt) throw notFound()
    if (version !== locked.version) throw versionConflict()

    const ok = await linkRepo.softDeleteLink(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await linkRepo.getLinkDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "link.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, status: locked.status, deleted_at: null },
      after: { title: record.title, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreLink(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: LinkDto }> {
  return db.transaction(async (tx) => {
    const locked = await linkRepo.lockLinkForUpdate(tx, id)
    if (!locked) throw notFound()
    if (!locked.deletedAt) throw new ContentError(422, "VALIDATION_ERROR", "该网址未被删除，无需恢复")
    if (version !== locked.version) throw versionConflict()

    // 恢复策略（§P6B）：分类/标签必须存在且未删除（409 阻断，保持「恢复后即可用」语义，
    // 管理员先改归属再恢复）；状态原样保留（发布态恢复后仍发布）
    const cat = await catRepo.getCategoryById(asExecutor(tx), locked.categoryId)
    if (!cat || cat.deletedAt) {
      throw new ContentError(409, "LINK_RESTORE_BLOCKED", "所属分类不存在或已被删除，请先重新指定分类再恢复")
    }
    if (locked.tagId) {
      const tag = await getTagById(asExecutor(tx), locked.tagId)
      if (!tag || tag.deletedAt) {
        throw new ContentError(409, "LINK_RESTORE_BLOCKED", "关联标签不存在或已被删除，请先重新指定标签再恢复")
      }
    }

    const ok = await linkRepo.restoreLink(tx, id, version)
    if (!ok) throw versionConflict()

    const record = await linkRepo.getLinkDto(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "link.restore",
      resourceType: RT,
      resourceId: id,
      before: { title: locked.title, deleted_at: locked.deletedAt },
      after: { title: record.title, deleted_at: null },
    })
    return { data: record }
  })
}
