"use client"

// P6A：网址分类管理页（两级树 + 搜索/状态过滤 + 新建/编辑/移动 + 状态级联 + 软删除/回收站）
// ─────────────────────────────────────────────────────────────────
// - 树数据来自 GET /categories/tree（服务端做"保留祖先"的一致性过滤）
// - "含已删除"视图切到 GET /categories?includeDeleted=true 的服务端分页表格（恢复入口）
// - 同级上/下移 → PATCH /categories/reorder（同父级作用域、双条目携带 version）
// - 所有写操作成功后重新拉取（乐观锁失败由服务端 409 文案提示并自动刷新版本）
import * as React from "react"
import { ChevronDown, ChevronRight, FolderTree, Inbox, ListTree, Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { CategoryDto, CategoryTreeNodeDto } from "@/lib/admin/dto/content"
import type { FilterState, PageResult, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import type { Column } from "../types/table"
import { CardLoadingSkeleton } from "../feedback/LoadingState"
import { ErrorState } from "../feedback/ErrorState"
import { EmptyState } from "../feedback/EmptyState"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { CategoryFormDialog, type CategoryFormValues, type CategoryParentOption } from "./CategoryFormDialog"
import { buildQuery, DeletedPill, IconClassPreview, PrimaryAction, RowAction, SecondaryAction, StatusPill, formatTime } from "./content-ui"

interface Props {
  csrfToken: string
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

interface ConfirmState {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  loading: boolean
  onConfirm: () => Promise<void>
}

const TREE_FIELDS: SearchFieldDef[] = [
  { key: "q", label: "关键词", type: "keyword", placeholder: "搜索分类名称" },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: [
      { label: "全部", value: "" },
      { label: "启用", value: "active" },
      { label: "停用", value: "disabled" },
    ],
  },
]

export function CategoriesManager({ csrfToken, canCreate, canUpdate, canDelete }: Props) {
  const { toast } = useToast()

  // ── 工具栏 / 视图 ─────────────────────────────────────────────
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [showDeleted, setShowDeleted] = React.useState(false)

  // ── 树视图状态 ───────────────────────────────────────────────
  const [tree, setTree] = React.useState<CategoryTreeNodeDto[]>([])
  const [treeLoading, setTreeLoading] = React.useState(true)
  const [treeError, setTreeError] = React.useState<AdminApiError | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  // ── 回收站表格状态（服务端分页/排序） ────────────────────────
  const [state, setState] = React.useState<TableState>(defaultTableState())
  const [rows, setRows] = React.useState<CategoryDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [listLoading, setListLoading] = React.useState(false)
  const [listError, setListError] = React.useState<AdminApiError | string | null>(null)

  // ── 弹窗 ─────────────────────────────────────────────────────
  const [formValues, setFormValues] = React.useState<CategoryFormValues | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // ── 数据加载 ─────────────────────────────────────────────────
  const loadTree = React.useCallback(async () => {
    setTreeLoading(true)
    setTreeError(null)
    const res = await adminGet<{ tree: CategoryTreeNodeDto[] }>(
      `/categories/tree${buildQuery({ q: applied.q, status: applied.status })}`,
    )
    if (res.ok) {
      setTree(res.data.tree ?? [])
      // 搜索时默认全部展开，方便命中定位
      setExpanded(new Set(res.data.tree.map((n) => n.id)))
    } else {
      setTreeError(res.error)
    }
    setTreeLoading(false)
  }, [applied])

  const loadList = React.useCallback(async () => {
    setListLoading(true)
    setListError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<CategoryDto>>(
      `/categories${buildQuery({
        q: applied.q,
        status: applied.status,
        includeDeleted: true,
        page: state.pagination.page,
        pageSize: state.pagination.pageSize,
        sortBy: sort.field,
        sortDir: sort.order,
      })}`,
    )
    if (res.ok) {
      setRows(res.data.items)
      setTotal(res.data.total)
    } else {
      setListError(res.error)
    }
    setListLoading(false)
  }, [applied, state])

  React.useEffect(() => {
    if (!showDeleted) void loadTree()
  }, [showDeleted, loadTree])

  React.useEffect(() => {
    if (showDeleted) void loadList()
  }, [showDeleted, loadList])

  const refresh = React.useCallback(() => {
    if (showDeleted) void loadList()
    else void loadTree()
  }, [showDeleted, loadList, loadTree])

  // ── 写操作 ───────────────────────────────────────────────────
  async function runGuarded(id: string, fn: () => Promise<AdminApiError | null>) {
    setBusyId(id)
    try {
      const err = await fn()
      if (err) {
        toast.error(err.message)
        // 版本冲突等场景：刷新拿到最新 version
        if (err.status === 409 || err.status === 404) refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function toggleStatus(row: { id: string; name: string; status: "active" | "disabled"; version: number }) {
    const next = row.status === "active" ? "disabled" : "active"
    await runGuarded(row.id, async () => {
      const res = await adminPatch<CategoryDto>(
        `/categories/${row.id}/status`,
        { status: next, version: row.version },
        { csrfToken },
      )
      if (res.ok) {
        toast.success(next === "disabled" ? `已停用「${row.name}」` : `已启用「${row.name}」`)
        refresh()
        return null
      }
      return res.error
    })
  }

  function askDelete(row: CategoryDto) {
    setConfirm({
      open: true,
      title: `删除分类「${row.name}」`,
      description: (
        <>
          软删除后分类不再出现在前台与树中，可在「含已删除」视图恢复。
          {row.parentId ? "（二级分类）" : "（停用一级分类会同时停用其下二级分类；删除前需先处理子分类与网址）"}
        </>
      ),
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<CategoryDto>(`/categories/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`分类「${row.name}」已删除`)
          setConfirm(null)
          refresh()
        } else {
          toast.error(res.error.message)
          setConfirm((c) => (c ? { ...c, loading: false } : c))
          if (res.error.status === 409 || res.error.status === 404) refresh()
        }
      },
    })
  }

  function askRestore(row: CategoryDto) {
    setConfirm({
      open: true,
      title: `恢复分类「${row.name}」`,
      description: "将清除删除标记。二级分类需要其上级分类先恢复。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<CategoryDto>(`/categories/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`分类「${row.name}」已恢复`)
          setConfirm(null)
          refresh()
        } else {
          toast.error(res.error.message)
          setConfirm((c) => (c ? { ...c, loading: false } : c))
          if (res.error.status === 409 || res.error.status === 404) refresh()
        }
      },
    })
  }

  /** 同级上/下移：交换相邻 sortOrder，整批 PATCH /categories/reorder */
  async function moveSibling(
    parentId: string | null,
    siblings: Array<{ id: string; sortOrder: number; version: number }>,
    index: number,
    direction: -1 | 1,
  ) {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    const a = siblings[index]
    const b = siblings[target]
    await runGuarded(a.id, async () => {
      const res = await adminPatch<{ records: CategoryDto[] }>(
        "/categories/reorder",
        {
          parentId,
          items: [
            { id: a.id, sortOrder: b.sortOrder, version: a.version },
            { id: b.id, sortOrder: a.sortOrder, version: b.version },
          ],
        },
        { csrfToken },
      )
      if (res.ok) {
        toast.success("排序已更新")
        refresh()
        return null
      }
      return res.error
    })
  }

  // ── 弹窗辅助 ─────────────────────────────────────────────────
  const parentOptions: CategoryParentOption[] = tree.map((n) => ({ value: n.id, label: n.name }))

  function openCreate(parentId?: string) {
    setFormValues({
      mode: "create",
      parentId: parentId ?? "",
      presetParentId: parentId,
    })
    setFormOpen(true)
  }

  function openEdit(row: CategoryDto) {
    setFormValues({
      mode: "edit",
      record: row,
      parentId: row.parentId ?? "",
      parentLockedReason:
        row.parentId === null && row.childCount > 0 ? "该分类下有子分类，不能移动为二级分类（会形成三级结构）" : undefined,
    })
    setFormOpen(true)
  }

  // ── 回收站表格列 ─────────────────────────────────────────────
  const listColumns: Column<CategoryDto>[] = [
    {
      key: "name",
      header: "名称",
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <IconClassPreview iconClass={r.iconClass} />
          <span className="font-medium">{r.name}</span>
          {r.deletedAt ? <DeletedPill /> : null}
        </div>
      ),
    },
    { key: "level", header: "层级", width: "90px", render: (r) => <span className="text-xs text-muted-foreground">{r.parentId ? "二级" : "一级"}</span> },
    { key: "linkCount", header: "网址数", align: "right", width: "90px", render: (r) => <span className="tabular-nums">{r.linkCount}</span> },
    { key: "childCount", header: "子分类", align: "right", width: "90px", render: (r) => <span className="tabular-nums">{r.childCount}</span> },
    { key: "status", header: "状态", width: "100px", render: (r) => <StatusPill status={r.status} /> },
    { key: "version", header: "版本", align: "right", width: "70px", render: (r) => <span className="font-mono text-xs">v{r.version}</span> },
    {
      key: "deletedAt",
      header: "删除时间",
      width: "170px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.deletedAt)}</span>,
    },
    {
      key: "createdAt",
      header: "创建时间",
      sortable: true,
      width: "170px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.createdAt)}</span>,
    },
  ]

  // ── 渲染 ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchToolbar
          fields={TREE_FIELDS}
          value={filter}
          onChange={setFilter}
          loading={showDeleted ? listLoading : treeLoading}
          onSearch={(next) => {
            setApplied(next)
            if (showDeleted) setState((s) => ({ ...s, pagination: { ...s.pagination, page: 1 } }))
          }}
          className="flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          {canCreate ? (
            <PrimaryAction onClick={() => openCreate()} disabled={showDeleted ? listLoading : treeLoading}>
              <Plus className="size-4" aria-hidden />
              新建一级分类
            </PrimaryAction>
          ) : null}
          <SecondaryAction
            onClick={() => setShowDeleted((v) => !v)}
            aria-pressed={showDeleted}
            title={showDeleted ? "返回两级树视图" : "查看含已删除记录的列表（恢复入口）"}
          >
            {showDeleted ? <ListTree className="size-4" aria-hidden /> : <Inbox className="size-4" aria-hidden />}
            {showDeleted ? "返回分类树" : "含已删除"}
          </SecondaryAction>
        </div>
      </div>

      {showDeleted ? (
        <DataTable<CategoryDto>
          columns={listColumns}
          data={rows}
          total={total}
          rowKey={(r) => r.id}
          state={state}
          onStateChange={setState}
          loading={listLoading}
          error={listError}
          onRetry={() => void loadList()}
          emptyTitle="没有记录"
          emptyDescription="当前筛选条件下没有分类（含已删除）。"
          minTableWidth={920}
          ariaLabel="网址分类列表（含已删除）"
          renderRowActions={(r) => (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {r.deletedAt ? (
                canDelete ? (
                  <RowAction onClick={() => askRestore(r)} loading={busyId === r.id} disabled={Boolean(busyId)}>
                    <Undo2 className="size-3.5" aria-hidden />
                    恢复
                  </RowAction>
                ) : null
              ) : (
                <>
                  {canUpdate ? (
                    <RowAction onClick={() => openEdit(r)} disabled={Boolean(busyId)}>
                      编辑
                    </RowAction>
                  ) : null}
                  {canUpdate ? (
                    <RowAction onClick={() => void toggleStatus(r)} loading={busyId === r.id} disabled={Boolean(busyId)}>
                      {r.status === "active" ? "停用" : "启用"}
                    </RowAction>
                  ) : null}
                  {canDelete ? (
                    <RowAction tone="danger" onClick={() => askDelete(r)} disabled={Boolean(busyId)}>
                      删除
                    </RowAction>
                  ) : null}
                </>
              )}
            </div>
          )}
        />
      ) : treeError ? (
        <div className="rounded-lg border border-border bg-card">
          <ErrorState
            description={treeError.message}
            requestId={treeError.requestId}
            onRetry={() => void loadTree()}
          />
        </div>
      ) : treeLoading ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <CardLoadingSkeleton lines={8} />
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            title={applied.q || applied.status ? "没有匹配的分类" : "还没有分类"}
            description={applied.q || applied.status ? "换个关键词或状态试试。" : "创建第一个一级分类开始搭建网址目录。"}
            action={
              canCreate && !applied.q && !applied.status ? (
                <PrimaryAction onClick={() => openCreate()}>
                  <Plus className="size-4" aria-hidden />
                  新建一级分类
                </PrimaryAction>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          <FolderTree className="sr-only" aria-hidden />
          {tree.map((node, i) => (
            <TreeBranch
              key={node.id}
              node={node}
              index={i}
              total={tree.length}
              canUpdate={canUpdate}
              canDelete={canDelete}
              canCreate={canCreate}
              busyId={busyId}
              expanded={expanded.has(node.id)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(node.id)) next.delete(node.id)
                  else next.add(node.id)
                  return next
                })
              }
              onEdit={openEdit}
              onCreateChild={() => openCreate(node.id)}
              onToggleStatus={(r) => void toggleStatus(r)}
              onDelete={askDelete}
              onMove={(index, dir) =>
                void moveSibling(
                  null,
                  tree.map((n) => ({ id: n.id, sortOrder: n.sortOrder, version: n.version })),
                  index,
                  dir,
                )
              }
              onMoveChild={(index, dir) =>
                void moveSibling(
                  node.id,
                  node.children.map((c) => ({ id: c.id, sortOrder: c.sortOrder, version: c.version })),
                  index,
                  dir,
                )
              }
            />
          ))}
        </div>
      )}

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        csrfToken={csrfToken}
        values={formValues}
        parentOptions={parentOptions}
        onSaved={() => refresh()}
      />

      <ConfirmDialog
        open={Boolean(confirm?.open)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        loading={confirm?.loading}
        defaultFocus="confirm"
        onConfirm={() => void confirm?.onConfirm()}
      />
    </div>
  )
}

// ── 树分支（一级行 + 可展开的二级行列表）─────────────────────────

interface BranchProps {
  node: CategoryTreeNodeDto
  index: number
  total: number
  canUpdate: boolean
  canDelete: boolean
  canCreate: boolean
  busyId: string | null
  expanded: boolean
  onToggleExpand: () => void
  onEdit: (row: CategoryDto) => void
  onCreateChild: () => void
  onToggleStatus: (row: CategoryDto) => void
  onDelete: (row: CategoryDto) => void
  onMove: (index: number, dir: -1 | 1) => void
  onMoveChild: (index: number, dir: -1 | 1) => void
}

function TreeBranch({
  node,
  index,
  total,
  canUpdate,
  canDelete,
  canCreate,
  busyId,
  expanded,
  onToggleExpand,
  onEdit,
  onCreateChild,
  onToggleStatus,
  onDelete,
  onMove,
  onMoveChild,
}: BranchProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="adm-touch-target inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={expanded ? "收起子分类" : `展开 ${node.name} 的子分类`}
          aria-expanded={expanded}
          disabled={node.children.length === 0}
        >
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        </button>
        <IconClassPreview iconClass={node.iconClass} size={20} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{node.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{node.id}</span> · 网址 {node.linkCount} · 子分类 {node.childCount} ·{" "}
            <span className="font-mono">v{node.version}</span>
          </p>
        </div>
        <StatusPill status={node.status} />
        <div className="flex flex-wrap items-center gap-1.5">
          <RowAction onClick={() => onMove(index, -1)} disabled={!canUpdate || index === 0 || Boolean(busyId)} title="上移">
            ↑
          </RowAction>
          <RowAction
            onClick={() => onMove(index, 1)}
            disabled={!canUpdate || index === total - 1 || Boolean(busyId)}
            title="下移"
          >
            ↓
          </RowAction>
          {canCreate ? <RowAction onClick={onCreateChild}>新建子分类</RowAction> : null}
          {canUpdate ? <RowAction onClick={() => onEdit(node)}>编辑</RowAction> : null}
          {canUpdate ? (
            <RowAction onClick={() => onToggleStatus(node)} loading={busyId === node.id} disabled={Boolean(busyId)}>
              {node.status === "active" ? "停用" : "启用"}
            </RowAction>
          ) : null}
          {canDelete ? (
            <RowAction tone="danger" onClick={() => onDelete(node)} disabled={Boolean(busyId)}>
              删除
            </RowAction>
          ) : null}
        </div>
      </div>
      {expanded
        ? node.children.map((child, ci) => (
            <div key={child.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted/30 py-2.5 pr-4 pl-14">
              <IconClassPreview iconClass={child.iconClass} size={16} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{child.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{child.id}</span> · 网址 {child.linkCount} ·{" "}
                  <span className="font-mono">v{child.version}</span>
                </p>
              </div>
              <StatusPill status={child.status} />
              <div className="flex flex-wrap items-center gap-1.5">
                <RowAction
                  onClick={() => onMoveChild(ci, -1)}
                  disabled={!canUpdate || ci === 0 || Boolean(busyId)}
                  title="上移"
                >
                  ↑
                </RowAction>
                <RowAction
                  onClick={() => onMoveChild(ci, 1)}
                  disabled={!canUpdate || ci === node.children.length - 1 || Boolean(busyId)}
                  title="下移"
                >
                  ↓
                </RowAction>
                {canUpdate ? <RowAction onClick={() => onEdit(child)}>编辑</RowAction> : null}
                {canUpdate ? (
                  <RowAction onClick={() => onToggleStatus(child)} loading={busyId === child.id} disabled={Boolean(busyId)}>
                    {child.status === "active" ? "停用" : "启用"}
                  </RowAction>
                ) : null}
                {canDelete ? (
                  <RowAction tone="danger" onClick={() => onDelete(child)} disabled={Boolean(busyId)}>
                    删除
                  </RowAction>
                ) : null}
              </div>
            </div>
          ))
        : null}
    </>
  )
}
