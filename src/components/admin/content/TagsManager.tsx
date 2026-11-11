"use client"

// P6A：标签管理页（列表 + 颜色/图标预览 + 状态切换 + 软删除/恢复 + 同级排序）
// 数据源：/api/admin/v1/tags（site_tags 无 updated_at 列，展示创建/删除时间）
import * as React from "react"
import { Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { TagDto } from "@/lib/admin/dto/content"
import type { Column, FilterState, PageResult, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { TagFormDialog } from "./TagFormDialog"
import { buildQuery, ColorCell, DeletedPill, IconClassPreview, PrimaryAction, RowAction, StatusPill, TagChipPreview, formatTime } from "./content-ui"

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
  { key: "q", label: "关键词", type: "keyword", placeholder: "搜索标签名称" },
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

export function TagsManager({ csrfToken, canCreate, canUpdate, canDelete }: Props) {
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "sortOrder", order: "asc" },
  })
  const [rows, setRows] = React.useState<TagDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TagDto | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<TagDto>>(
      `/tags${buildQuery({
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

  async function toggleStatus(row: TagDto) {
    const next = row.status === "active" ? "disabled" : "active"
    setBusyId(row.id)
    const res = await adminPatch<TagDto>(`/tags/${row.id}/status`, { status: next, version: row.version }, { csrfToken })
    setBusyId(null)
    if (res.ok) {
      toast.success(next === "disabled" ? `已停用「${row.name}」` : `已启用「${row.name}」`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: TagDto) {
    setConfirm({
      open: true,
      title: `删除标签「${row.name}」`,
      description: `软删除后可在「含已删除」视图恢复。该标签仍被网址使用（${row.linkCount} 个，含已删除网址）时无法删除，需先解除引用。`,
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<TagDto>(`/tags/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`标签「${row.name}」已删除`)
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

  function askRestore(row: TagDto) {
    setConfirm({
      open: true,
      title: `恢复标签「${row.name}」`,
      description: "将清除删除标记，标签重新出现在列表与前台。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<TagDto>(`/tags/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`标签「${row.name}」已恢复`)
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
    const res = await adminPatch<{ records: TagDto[] }>(
      "/tags/reorder",
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

  const columns: Column<TagDto>[] = [
    {
      key: "name",
      header: "标签",
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
    {
      key: "preview",
      header: "样式预览",
      width: "170px",
      render: (r) => <TagChipPreview name={r.name} iconClass={r.iconClass} color={r.color} bgColor={r.bgColor} />,
    },
    {
      key: "color",
      header: "颜色（文字/背景）",
      width: "190px",
      render: (r) => (
        <div className="space-y-1">
          <ColorCell value={r.color} />
          <ColorCell value={r.bgColor} />
        </div>
      ),
    },
    { key: "linkCount", header: "网址数", align: "right", width: "84px", render: (r) => <span className="tabular-nums">{r.linkCount}</span> },
    { key: "sortOrder", header: "排序", sortable: true, align: "right", width: "72px", render: (r) => <span className="tabular-nums">{r.sortOrder}</span> },
    { key: "status", header: "状态", width: "90px", render: (r) => <StatusPill status={r.status} /> },
    { key: "version", header: "版本", align: "right", width: "64px", render: (r) => <span className="font-mono text-xs">v{r.version}</span> },
    {
      key: "createdAt",
      header: "创建时间",
      sortable: true,
      width: "168px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.createdAt)}</span>,
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
            新建标签
          </PrimaryAction>
        ) : null}
      </div>

      <DataTable<TagDto>
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="暂无标签"
        emptyDescription="创建第一个标签，或调整筛选条件。"
        minTableWidth={1080}
        ariaLabel="标签列表"
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

      <TagFormDialog open={formOpen} onOpenChange={setFormOpen} csrfToken={csrfToken} record={editing} onSaved={() => void load()} />

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
