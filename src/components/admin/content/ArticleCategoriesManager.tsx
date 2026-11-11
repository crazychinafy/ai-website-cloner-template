"use client"

// P6A：文章分类管理页（平铺列表；服务端分页/排序/筛选 + 状态切换 + 软删除/恢复 + 同级排序）
// 数据源：/api/admin/v1/article-categories（独立资源，与网址分类互不影响）
import * as React from "react"
import { Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { ArticleCategoryDto } from "@/lib/admin/dto/content"
import type { Column, FilterState, PageResult, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { ArticleCategoryFormDialog } from "./ArticleCategoryFormDialog"
import { buildQuery, DeletedPill, IconClassPreview, PrimaryAction, RowAction, StatusPill, formatTime } from "./content-ui"

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

const FIELDS: SearchFieldDef[] = [
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
  {
    key: "includeDeleted",
    label: "删除范围",
    type: "select",
    options: [
      { label: "仅未删除", value: "" },
      { label: "含已删除", value: "true" },
    ],
  },
]

export function ArticleCategoriesManager({ csrfToken, canCreate, canUpdate, canDelete }: Props) {
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "sortOrder", order: "asc" },
  })
  const [rows, setRows] = React.useState<ArticleCategoryDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ArticleCategoryDto | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<ArticleCategoryDto>>(
      `/article-categories${buildQuery({
        q: applied.q,
        status: applied.status,
        includeDeleted: applied.includeDeleted === "true" ? true : undefined,
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
      setError(res.error)
    }
    setLoading(false)
  }, [applied, state])

  React.useEffect(() => {
    void load()
  }, [load])

  async function toggleStatus(row: ArticleCategoryDto) {
    const next = row.status === "active" ? "disabled" : "active"
    setBusyId(row.id)
    const res = await adminPatch<ArticleCategoryDto>(
      `/article-categories/${row.id}/status`,
      { status: next, version: row.version },
      { csrfToken },
    )
    setBusyId(null)
    if (res.ok) {
      toast.success(next === "disabled" ? `已停用「${row.name}」` : `已启用「${row.name}」`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: ArticleCategoryDto) {
    setConfirm({
      open: true,
      title: `删除文章分类「${row.name}」`,
      description: `软删除后可在「含已删除」视图恢复。该分类下仍有文章（${row.articleCount} 篇，含已删除）时无法删除，需先转移或删除文章。`,
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<ArticleCategoryDto>(`/article-categories/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`文章分类「${row.name}」已删除`)
          setConfirm(null)
          void load()
        } else {
          toast.error(res.error.message)
          setConfirm((c) => (c ? { ...c, loading: false } : c))
          if (res.error.status === 409 || res.error.status === 404) void load()
        }
      },
    })
  }

  function askRestore(row: ArticleCategoryDto) {
    setConfirm({
      open: true,
      title: `恢复文章分类「${row.name}」`,
      description: "将清除删除标记，分类重新出现在列表与前台。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<ArticleCategoryDto>(
          `/article-categories/${row.id}/restore`,
          { version: row.version },
          { csrfToken },
        )
        if (res.ok) {
          toast.success(`文章分类「${row.name}」已恢复`)
          setConfirm(null)
          void load()
        } else {
          toast.error(res.error.message)
          setConfirm((c) => (c ? { ...c, loading: false } : c))
          if (res.error.status === 409 || res.error.status === 404) void load()
        }
      },
    })
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    const a = rows[index]
    const b = rows[target]
    setBusyId(a.id)
    const res = await adminPatch<{ records: ArticleCategoryDto[] }>(
      "/article-categories/reorder",
      {
        items: [
          { id: a.id, sortOrder: b.sortOrder, version: a.version },
          { id: b.id, sortOrder: a.sortOrder, version: b.version },
        ],
      },
      { csrfToken },
    )
    setBusyId(null)
    if (res.ok) {
      toast.success("排序已更新")
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  const columns: Column<ArticleCategoryDto>[] = [
    {
      key: "name",
      header: "分类名称",
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <IconClassPreview iconClass={r.iconClass} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {r.name} {r.deletedAt ? <DeletedPill /> : null}
            </p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.id}</p>
          </div>
        </div>
      ),
    },
    { key: "articleCount", header: "文章数", align: "right", width: "90px", render: (r) => <span className="tabular-nums">{r.articleCount}</span> },
    { key: "sortOrder", header: "排序", sortable: true, align: "right", width: "80px", render: (r) => <span className="tabular-nums">{r.sortOrder}</span> },
    { key: "status", header: "状态", width: "90px", render: (r) => <StatusPill status={r.status} /> },
    { key: "version", header: "版本", align: "right", width: "64px", render: (r) => <span className="font-mono text-xs">v{r.version}</span> },
    {
      key: "createdAt",
      header: "创建时间",
      sortable: true,
      width: "168px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.createdAt)}</span>,
    },
    {
      key: "deletedAt",
      header: "删除时间",
      width: "168px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.deletedAt)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchToolbar
          fields={FIELDS}
          value={filter}
          onChange={setFilter}
          loading={loading}
          onSearch={(next) => {
            setApplied(next)
            setState((s) => ({ ...s, pagination: { ...s.pagination, page: 1 } }))
          }}
          className="flex-1"
        />
        {canCreate ? (
          <PrimaryAction
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" aria-hidden />
            新建文章分类
          </PrimaryAction>
        ) : null}
      </div>

      <DataTable<ArticleCategoryDto>
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="暂无文章分类"
        emptyDescription="创建第一个文章分类，或调整筛选条件。"
        minTableWidth={960}
        ariaLabel="文章分类列表"
        renderRowActions={(r) => {
          const index = rows.findIndex((x) => x.id === r.id)
          return (
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
                  <RowAction onClick={() => void move(index, -1)} disabled={!canUpdate || index <= 0 || Boolean(busyId)} title="上移">
                    ↑
                  </RowAction>
                  <RowAction
                    onClick={() => void move(index, 1)}
                    disabled={!canUpdate || index === rows.length - 1 || Boolean(busyId)}
                    title="下移"
                  >
                    ↓
                  </RowAction>
                  {canUpdate ? (
                    <RowAction
                      onClick={() => {
                        setEditing(r)
                        setFormOpen(true)
                      }}
                      disabled={Boolean(busyId)}
                    >
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
          )
        }}
      />

      <ArticleCategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        csrfToken={csrfToken}
        record={editing}
        onSaved={() => void load()}
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
