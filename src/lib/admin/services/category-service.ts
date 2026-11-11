// P6A：网址分类 Service（业务规则 + 事务 + 审计；Route 只做守卫与解析）
// ─────────────────────────────────────────────────────────────────
// 规则（P6A 任务书 §4/§5/§10）：
// - 两级结构：二级分类的 parentId 必须指向未删除的一级分类；不允许三级/自引用
// - 所有写操作在单个事务内完成，审计行与业务写入同事务（失败一起回滚）
// - 乐观锁：提交 version ≠ 当前 version → 409 VERSION_CONFLICT
// - 软删除前置保护：分类下（含软删除）仍有网址 → 拒绝；存在未删除子分类 → 拒绝
// - 状态级联：停用一级分类 → 其下启用中的二级分类同事务停用（恢复不自动级联）
import "server-only"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import type { WriteCtx } from "../audit/audit-writer.ts"
import { writeAudit } from "../audit/audit-writer.ts"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { asExecutor } from "../repositories/executor.ts"
import * as catRepo from "../repositories/category-repository.ts"
import type { CategoryListQuery, CategoryTreeQuery, CreateCategoryInput, ReorderCategoriesInput, UpdateCategoryInput } from "../validation/category-schema.ts"
import type { CategoryDto, CategoryTreeNodeDto } from "../dto/content.ts"
import { pageResult } from "../dto/content.ts"

const RT = "link_category"

export interface StatusChangeInput {
  status: "active" | "disabled"
  version: number
}

// ── 读 ───────────────────────────────────────────────────────────

export async function listCategories(q: CategoryListQuery, db: AdminDb = getDrizzle()) {
  const { items, total } = await catRepo.listCategories(asExecutor(db), q)
  return { data: pageResult(items, total, q.page, q.pageSize) }
}

export async function getCategory(id: string, db: AdminDb = getDrizzle()) {
  const row = await catRepo.getCategoryById(asExecutor(db), id)
  if (!row) throw new ContentError(404, "CATEGORY_NOT_FOUND", "分类不存在")
  return { data: row }
}

/** 管理页树：全量未删除 → 组装两级 → 按 q/status 做“保留祖先”的一致性过滤 */
export async function getCategoryTree(q: CategoryTreeQuery, db: AdminDb = getDrizzle()) {
  const all = await catRepo.listAllActiveCategories(asExecutor(db))
  const tree = buildTree(all)
  return { data: { tree: filterTree(tree, q) } }
}

function buildTree(rows: CategoryDto[]): CategoryTreeNodeDto[] {
  const byId = new Map<string, CategoryTreeNodeDto>()
  for (const r of rows) byId.set(r.id, { ...r, children: [] })
  const roots: CategoryTreeNodeDto[] = []
  for (const r of rows) {
    const node = byId.get(r.id)!
    if (r.parentId !== null) {
      const parent = byId.get(r.parentId)
      if (parent) parent.children.push(node)
      // 极端数据（孤儿二级分类）直接丢弃出树；列表接口仍可见
    } else {
      roots.push(node)
    }
  }
  return roots
}

function filterTree(nodes: CategoryTreeNodeDto[], q: CategoryTreeQuery): CategoryTreeNodeDto[] {
  const term = q.q ? q.q.toLowerCase() : null
  const out: CategoryTreeNodeDto[] = []
  for (const n of nodes) {
    const kids = filterTree(n.children, q)
    const selfMatch = (term === null || n.name.toLowerCase().includes(term)) && (!q.status || n.status === q.status)
    if (kids.length > 0 || selfMatch) {
      out.push({ ...n, children: kids })
    }
  }
  return out
}

// ── 写（全部单事务 + 同事务审计）─────────────────────────────────

export async function createCategory(
  ctx: WriteCtx,
  input: CreateCategoryInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: CategoryDto }> {
  const parentId = input.parentId ?? null
  return db.transaction(async (tx) => {
    if (parentId !== null) await assertParentUsable(asExecutor(tx), parentId)
    const conflict = await catRepo.findCategoryNameConflict(asExecutor(tx), input.name, parentId)
    if (conflict) throw nameConflict()
    const sortOrder = input.sortOrder ?? (await catRepo.maxSortOrderInScope(asExecutor(tx), parentId)) + 1
    const id = await catRepo.insertCategory(tx, {
      name: input.name,
      parentId,
      iconClass: input.iconClass ?? "",
      sortOrder,
      status: input.status ?? "active",
    })
    const record = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!record) throw new ContentError(500, "INTERNAL_ERROR", "分类创建后读取失败")
    await writeAudit(tx, ctx, {
      action: "category.create",
      resourceType: RT,
      resourceId: id,
      before: null,
      after: { name: record.name, parent_id: parentId, icon_class: record.iconClass, sort_order: record.sortOrder, status: record.status },
    })
    return { data: record }
  })
}

export async function updateCategory(
  ctx: WriteCtx,
  id: string,
  input: UpdateCategoryInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: CategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()

    const patch: catRepo.CategoryPatch = {}
    const moving = input.parentId !== undefined
    const newParentId = moving ? (input.parentId ?? null) : (current.parentId as string | null)
    if (moving) {
      if (newParentId === id) throw new ContentError(422, "CATEGORY_CYCLE", "不能把分类移动到自身之下")
      if (newParentId !== null) {
        await assertParentUsable(asExecutor(tx), newParentId)
        // 成为二级分类的前提：自身当前没有任何子分类（否则出现三级结构）
        const children = await catRepo.getDirectChildren(asExecutor(tx), id)
        if (children.length > 0) {
          throw new ContentError(
            409,
            "CATEGORY_CYCLE",
            "该分类下仍有子分类，二级分类不能再包含子分类；请先移动或删除其子分类",
          )
        }
      }
      patch.parentId = newParentId
    }
    const newName = input.name ?? current.name
    if (input.name !== undefined || moving) {
      const conflict = await catRepo.findCategoryNameConflict(asExecutor(tx), newName, newParentId, id)
      if (conflict) throw nameConflict()
      patch.name = newName
    }
    if (input.iconClass !== undefined) patch.iconClass = input.iconClass
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder
    let cascadedChildren = 0
    if (input.status !== undefined) {
      await assertStatusAllowed(asExecutor(tx), current, input.status)
      patch.status = input.status
    }

    const ok = await catRepo.updateCategoryWithVersion(tx, id, input.version, patch)
    if (!ok) throw versionConflict()

    // 停用一级分类 → 级联停用启用中的二级分类（同事务；审计汇总条数）
    if (input.status === "disabled" && current.parentId === null) {
      cascadedChildren = await catRepo.disableChildrenOf(tx, id)
    }

    const record = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    const beforeSnap = diffBefore(current, input)
    await writeAudit(tx, ctx, {
      action: "category.update",
      resourceType: RT,
      resourceId: id,
      before: beforeSnap,
      after: { ...diffAfter(input), ...(moving ? { parent_id: newParentId } : {}), ...(cascadedChildren > 0 ? { cascaded_disabled_children: cascadedChildren } : {}) },
    })
    return { data: record }
  })
}

/** 启用/停用快捷端点：内部走同一规则（级联/前置检查），审计 action 区分 enable/disable */
export async function changeCategoryStatus(
  ctx: WriteCtx,
  id: string,
  input: StatusChangeInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: CategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (input.version !== current.version) throw versionConflict()
    await assertStatusAllowed(asExecutor(tx), current, input.status)
    const ok = await catRepo.updateCategoryWithVersion(tx, id, input.version, { status: input.status })
    if (!ok) throw versionConflict()
    let cascadedChildren = 0
    if (input.status === "disabled" && current.parentId === null) {
      cascadedChildren = await catRepo.disableChildrenOf(tx, id)
    }
    const record = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: input.status === "active" ? "category.enable" : "category.disable",
      resourceType: RT,
      resourceId: id,
      before: { status: current.status },
      after: { status: input.status, ...(cascadedChildren > 0 ? { cascaded_disabled_children: cascadedChildren } : {}) },
    })
    return { data: record }
  })
}

export async function reorderCategories(
  ctx: WriteCtx,
  input: ReorderCategoriesInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: { records: CategoryDto[] } }> {
  return db.transaction(async (tx) => {
    if (input.parentId !== null) await assertParentUsable(asExecutor(tx), input.parentId)
    const records: CategoryDto[] = []
    for (const item of input.items) {
      const row = await catRepo.getCategoryById(asExecutor(tx), item.id)
      if (!row || row.deletedAt) throw notFound()
      if ((row.parentId as string | null) !== input.parentId) {
        throw new ContentError(
          409,
          "REORDER_SCOPE_MISMATCH",
          `分类 ${item.id} 不属于当前排序范围（同一父级下才能一起排序）`,
        )
      }
      if (row.version !== item.version) throw versionConflict()
      const ok = await catRepo.setCategorySortOrderWithVersion(tx, item.id, item.version, item.sortOrder)
      if (!ok) throw versionConflict()
    }
    for (const item of input.items) {
      const r = await catRepo.getCategoryById(asExecutor(tx), item.id)
      if (r) records.push(r)
    }
    await writeAudit(tx, ctx, {
      action: "category.reorder",
      resourceType: RT,
      resourceId: input.parentId ?? "root",
      before: null,
      after: {
        parent_id: input.parentId,
        items: input.items.map((i) => ({ id: i.id, sort_order: i.sortOrder })),
      },
    })
    return { data: { records } }
  })
}

export async function deleteCategory(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: CategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!current || current.deletedAt) throw notFound()
    if (version !== current.version) throw versionConflict()

    // 保护 1：未删除子分类必须先处理（两级结构不允许悬空二级）
    const children = await catRepo.getDirectChildren(asExecutor(tx), id)
    if (children.some((c) => !c.deleted)) {
      throw new ContentError(409, "CATEGORY_HAS_CHILDREN", "该分类下仍有二级分类，请先删除或移动这些子分类")
    }
    // 保护 2：引用计数（软删除网址也算引用，防止恢复后指向已删除分类）
    const linkCounts = await catRepo.countLinksByCategoryIds(asExecutor(tx), [id])
    const linkCount = linkCounts.get(id) ?? 0
    if (linkCount > 0) {
      throw new ContentError(
        409,
        "CATEGORY_HAS_LINKS",
        `该分类下仍有 ${linkCount} 个网址（含已删除），请先转移或删除这些网址`,
      )
    }

    const ok = await catRepo.softDeleteCategory(tx, id, version)
    if (!ok) throw versionConflict()
    const record = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "category.soft_delete",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: null },
      after: { name: record.name, deleted_at: record.deletedAt },
    })
    return { data: record }
  })
}

export async function restoreCategory(
  ctx: WriteCtx,
  id: string,
  version: number,
  db: AdminDb = getDrizzle(),
): Promise<{ data: CategoryDto }> {
  return db.transaction(async (tx) => {
    const current = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!current) throw notFound()
    if (!current.deletedAt) {
      throw new ContentError(422, "VALIDATION_ERROR", "该分类未被删除，无需恢复")
    }
    if (version !== current.version) throw versionConflict()
    // 二级分类的父级必须活着（或先恢复一级分类）
    if (current.parentId !== null) {
      const parent = await catRepo.getCategoryBrief(asExecutor(tx), current.parentId)
      if (!parent) throw new ContentError(409, "CATEGORY_PARENT_NOT_FOUND", "上级分类不存在，无法恢复")
      if (parent.deletedAt) {
        throw new ContentError(409, "CATEGORY_RESTORE_BLOCKED", `上级分类「${parent.name}」尚未恢复，请先恢复上级分类`)
      }
    }
    const ok = await catRepo.restoreCategory(tx, id, version)
    if (!ok) throw versionConflict()
    const record = await catRepo.getCategoryById(asExecutor(tx), id)
    if (!record) throw notFound()
    await writeAudit(tx, ctx, {
      action: "category.restore",
      resourceType: RT,
      resourceId: id,
      before: { name: current.name, deleted_at: current.deletedAt },
      after: { name: record.name, deleted_at: null },
    })
    return { data: record }
  })
}

// ── 内部断言 ─────────────────────────────────────────────────────

function notFound(): ContentError {
  return new ContentError(404, "CATEGORY_NOT_FOUND", "分类不存在或已被删除")
}

function nameConflict(): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "同一上级分类下已存在同名分类", { name: "同一上级分类下已存在同名分类" })
}

/** parentId 可用性：存在 + 未删除 + 一级 */
async function assertParentUsable(exec: Parameters<typeof catRepo.getCategoryBrief>[0], parentId: string): Promise<void> {
  const parent = await catRepo.getCategoryBrief(exec, parentId)
  if (!parent || parent.deletedAt) {
    throw new ContentError(422, "CATEGORY_PARENT_NOT_FOUND", "上级分类不存在或已被删除", {
      parentId: "上级分类不存在或已被删除",
    })
  }
  if (parent.parentId !== null) {
    throw new ContentError(422, "CATEGORY_PARENT_NOT_LEVEL_ONE", "只能选择一级分类作为上级", {
      parentId: "只能选择一级分类作为上级",
    })
  }
}

/** 状态机规则：二级分类启用前，一级必须启用（一级停用会级联停用二级） */
async function assertStatusAllowed(
  exec: Parameters<typeof catRepo.getCategoryBrief>[0],
  current: { parentId: string | null; status: string },
  next: "active" | "disabled",
): Promise<void> {
  if (next === "active" && current.parentId !== null) {
    const parent = await catRepo.getCategoryBrief(exec, current.parentId)
    if (!parent || parent.deletedAt) {
      throw new ContentError(409, "CATEGORY_PARENT_NOT_FOUND", "上级分类不存在或已被删除，无法启用该二级分类")
    }
    if (parent.status === "disabled") {
      throw new ContentError(409, "VALIDATION_ERROR", `上级分类「${parent.name}」处于停用状态，请先启用上级分类`, {
        status: "上级分类处于停用状态，请先启用上级分类",
      })
    }
  }
}

function diffBefore(row: CategoryDto, input: UpdateCategoryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.name !== undefined) out.name = row.name
  if (input.parentId !== undefined) out.parent_id = row.parentId
  if (input.iconClass !== undefined) out.icon_class = row.iconClass
  if (input.sortOrder !== undefined) out.sort_order = row.sortOrder
  if (input.status !== undefined) out.status = row.status
  return out
}

function diffAfter(input: UpdateCategoryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.name !== undefined) out.name = input.name
  if (input.iconClass !== undefined) out.icon_class = input.iconClass
  if (input.sortOrder !== undefined) out.sort_order = input.sortOrder
  if (input.status !== undefined) out.status = input.status
  return out
}
