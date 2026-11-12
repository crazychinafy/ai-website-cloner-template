"use client"

// P6D：线路管理列表（§11.3：搜索 + 新建/编辑 + 上下移 + 启用/停用 + 软删除恢复）
// ─────────────────────────────────────────────────────────────────
// - 数据源：GET /lines（服务端分页/排序/筛选；status 只有 active|disabled）
// - 启停走 PATCH /lines/[id]/status（lines.update）；恢复走 POST /lines/[id]/restore（lines.delete）
// - 上移/下移：全局排序作用域，与当前页相邻未删除行交换 sortOrder，POST /lines/reorder
//   （单事务逐行乐观锁；body 不接受 position —— 线路无位置分组）
// - 列表与保存都不做 URL 可达性探测（§6.7 禁服务端 fetch；探测属前台）
import * as React from "react"
import { ArrowDown, ArrowUp, Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { LineDto, LineStatus } from "@/lib/admin/dto/line"
import type { PageResult } from "@/lib/admin/dto/content"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { buildQuery, DeletedPill, formatTime, PrimaryAction, RowAction, StatusPill } from "./content-ui"
import { LineFormDialog } from "./LineFormDialog"

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

export function LinesManager({ csrfToken, canCreate, canUpdate, canDelete }: Props) {
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "sortOrder", order: "asc" },
  })
  const [rows, setRows] = React.useState<LineDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<LineDto | null>(null)
  const dirtyRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<LineDto>>(
      `/lines${buildQuery({
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

  const fields: SearchFieldDef[] = [
    { key: "q", label: "关键词", type: "keyword", placeholder: "搜索线路名称 / URL" },
    {
      key: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "全部状态", value: "" },
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

  function openCreate() {
    dirtyRef.current = false
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(row: LineDto) {
    dirtyRef.current = false
    setEditing(row)
    setDialogOpen(true)
  }

  function closeDialog(open: boolean) {
    setDialogOpen(open)
    if (!open && dirtyRef.current) {
      dirtyRef.current = false
      void load()
    }
  }

  function mergeSaved(record: LineDto) {
    dirtyRef.current = true
    setRows((prev) => prev.map((r) => (r.id === record.id ? record : r)))
  }

  async function changeStatus(row: LineDto, label: string, next: LineStatus) {
    setBusyId(row.id)
    const res = await adminPatch<LineDto>(`/lines/${row.id}/status`, { status: next, version: row.version }, { csrfToken })
    setBusyId(null)
    if (res.ok) {
      toast.success(`线路「${row.name}」已${label}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  async function move(row: LineDto, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === row.id)
    const other = rows[idx + dir]
    if (idx < 0 || !other) return
    setBusyId(row.id)
    const res = await adminPost<LineDto[]>(
      "/lines/reorder",
      {
        items: [
          { id: row.id, sortOrder: other.sortOrder, version: row.version },
          { id: other.id, sortOrder: row.sortOrder, version: other.version },
        ],
      },
      { csrfToken },
    )
    setBusyId(null)
    if (res.ok) {
      toast.success(`线路「${row.name}」已${dir === -1 ? "上移" : "下移"}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: LineDto) {
    setConfirm({
      open: true,
      title: `删除线路「${row.name}」`,
      description: "软删除后可在「含已删除」视图恢复；前台立即下架，状态与排序值保留。",
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<LineDto>(`/lines/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`线路「${row.name}」已删除`)
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

  function askRestore(row: LineDto) {
    setConfirm({
      open: true,
      title: `恢复线路「${row.name}」`,
      description: "恢复软删除行：保留原状态（启用/停用）与排序值。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<LineDto>(`/lines/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`线路「${row.name}」已恢复`)
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

  const columns: Column<LineDto>[] = [
    {
      key: "name",
      header: "线路名称",
      sortable: true,
      render: (r) => (
        <div className="flex min-w-36 flex-col gap-1">
          <span className="font-medium text-foreground">{r.name}</span>
          {r.deletedAt ? <DeletedPill /> : null}
        </div>
      ),
    },
    {
      key: "url",
      header: "URL",
      render: (r) => (
        <span className="block max-w-96 truncate font-mono text-xs text-muted-foreground" title={r.url}>
          {r.url}
        </span>
      ),
    },
    { key: "status", header: "状态", sortable: true, width: "84px", render: (r) => <StatusPill status={r.status} /> },
    { key: "sortOrder", header: "排序", sortable: true, align: "right", width: "64px" },
    { key: "updatedAt", header: "更新时间", sortable: true, width: "150px", render: (r) => <span className="text-xs">{formatTime(r.updatedAt)}</span> },
  ]

  function renderActions(r: LineDto) {
    if (r.deletedAt) {
      return canDelete ? (
        <RowAction onClick={() => askRestore(r)} disabled={Boolean(busyId)} title="恢复">
          <Undo2 className="size-3.5" aria-hidden />
          恢复
        </RowAction>
      ) : null
    }
    const idx = rows.findIndex((x) => x.id === r.id)
    const canMoveUp = idx > 0 && !rows[idx - 1]?.deletedAt
    const canMoveDown = idx >= 0 && idx < rows.length - 1 && !rows[idx + 1]?.deletedAt
    return (
      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {canUpdate ? (
          <RowAction onClick={() => openEdit(r)} disabled={Boolean(busyId)} title="编辑">
            编辑
          </RowAction>
        ) : null}
        {canUpdate ? (
          <>
            <RowAction
              onClick={() => void changeStatus(r, "启用", "active")}
              disabled={Boolean(busyId) || r.status === "active"}
              title="启用（status → active）"
            >
              启用
            </RowAction>
            <RowAction
              onClick={() => void changeStatus(r, "停用", "disabled")}
              disabled={Boolean(busyId) || r.status === "disabled"}
              title="停用（status → disabled）"
            >
              停用
            </RowAction>
            <RowAction onClick={() => void move(r, -1)} disabled={!canMoveUp || Boolean(busyId)} title="上移">
              <ArrowUp className="size-3.5" aria-hidden />
            </RowAction>
            <RowAction onClick={() => void move(r, 1)} disabled={!canMoveDown || Boolean(busyId)} title="下移">
              <ArrowDown className="size-3.5" aria-hidden />
            </RowAction>
          </>
        ) : null}
        {canDelete ? (
          <RowAction tone="danger" onClick={() => askDelete(r)} disabled={Boolean(busyId)} title="软删除">
            删除
          </RowAction>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchToolbar
          fields={fields}
          value={filter}
          onChange={setFilter}
          onSearch={(next) => {
            setApplied(next)
            setState((s) => ({ ...s, pagination: { ...s.pagination, page: 1 } }))
          }}
          loading={loading}
          className="flex-1"
        />
        {canCreate ? (
          <PrimaryAction onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            新建线路
          </PrimaryAction>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        renderRowActions={renderActions}
        emptyTitle="暂无线路"
        emptyDescription="点击右上角「新建线路」添加第一条线路（新建成时默认为停用）。"
        minTableWidth={900}
        ariaLabel="线路列表"
      />

      <LineFormDialog
        open={dialogOpen}
        onOpenChange={closeDialog}
        record={editing}
        csrfToken={csrfToken}
        canUpdate={canUpdate}
        onSaved={mergeSaved}
      />

      <ConfirmDialog
        open={Boolean(confirm?.open)}
        onOpenChange={(open) => {
          if (!open && !confirm?.loading) setConfirm(null)
        }}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        loading={confirm?.loading}
        onConfirm={() => void confirm?.onConfirm()}
      />
    </div>
  )
}
