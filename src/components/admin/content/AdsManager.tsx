"use client"

// P6D：广告管理列表（§11.1：缩略图/排期/状态/有效状态 + 筛选 + 启用停用 + 上下移 + 软删除恢复）
// ─────────────────────────────────────────────────────────────────
// - 数据源：GET /ads（服务端分页/排序/筛选；effectiveStatus 由服务端计算，只读展示）
// - 状态机与服务端一致：draft→启用 / active→停用 / disabled→启用 / expired→启用|停用（均需 ads.update）
// - 上移/下移：与当前页相邻未删除行交换 sortOrder，POST /ads/reorder（同位置作用域；
//   任一版本冲突整批回滚）；删除行不参与排序交换
// - 「预览」只在新窗口打开站内图片，绝不自动访问外部跳转地址（§11.1）
// - 编辑/新建走弹窗 AdFormDialog；回收站 = 「含已删除」筛选（恢复保留原状态与排序值）
import * as React from "react"
import { ArrowDown, ArrowUp, Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { AdDbStatus, AdDto } from "@/lib/admin/dto/ad"
import type { PageResult } from "@/lib/admin/dto/content"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import {
  AdEffectivePill,
  AdStatusPill,
  buildQuery,
  DeletedPill,
  formatTime,
  MediaPreview,
  PrimaryAction,
  resolveMediaSrc,
  RowAction,
} from "./content-ui"
import { AdFormDialog } from "./AdFormDialog"

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

const STATUS_ACTIONS: Record<AdDbStatus, { label: string; next: "active" | "disabled" }[]> = {
  draft: [{ label: "启用", next: "active" }],
  active: [{ label: "停用", next: "disabled" }],
  disabled: [{ label: "启用", next: "active" }],
  expired: [
    { label: "启用", next: "active" },
    { label: "停用", next: "disabled" },
  ],
}

export function AdsManager({ csrfToken, canCreate, canUpdate, canDelete }: Props) {
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "sortOrder", order: "asc" },
  })
  const [rows, setRows] = React.useState<AdDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<AdDto | null>(null)
  const dirtyRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<AdDto>>(
      `/ads${buildQuery({
        q: applied.q,
        position: applied.position,
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
    { key: "q", label: "关键词", type: "keyword", placeholder: "搜索标题 / 跳转地址" },
    {
      key: "position",
      label: "广告位置",
      type: "select",
      options: [
        { label: "全部位置", value: "" },
        { label: "首页（home）", value: "home" },
      ],
    },
    {
      key: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "全部状态", value: "" },
        { label: "草稿", value: "draft" },
        { label: "启用", value: "active" },
        { label: "停用", value: "disabled" },
        { label: "已过期", value: "expired" },
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

  function openEdit(row: AdDto) {
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

  /** 弹窗任意写操作成功 → 合并进行内数据并标记需要刷新 */
  function mergeSaved(record: AdDto) {
    dirtyRef.current = true
    setRows((prev) => prev.map((r) => (r.id === record.id ? record : r)))
  }

  const knownImagePaths = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.imagePath).filter(Boolean))),
    [rows],
  )

  async function changeStatus(row: AdDto, label: string, next: "active" | "disabled") {
    setBusyId(row.id)
    const res = await adminPatch<AdDto>(`/ads/${row.id}/status`, { status: next, version: row.version }, { csrfToken })
    setBusyId(null)
    if (res.ok) {
      toast.success(`广告「${row.title}」已${label}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  /** 上移/下移：与当前页相邻未删除行交换 sortOrder（同位置作用域，逐行乐观锁，整批回滚） */
  async function move(row: AdDto, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === row.id)
    const other = rows[idx + dir]
    if (idx < 0 || !other) return
    setBusyId(row.id)
    const res = await adminPost<AdDto[]>(
      "/ads/reorder",
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
      toast.success(`广告「${row.title}」已${dir === -1 ? "上移" : "下移"}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: AdDto) {
    setConfirm({
      open: true,
      title: `删除广告「${row.title}」`,
      description: "软删除后可在「含已删除」视图恢复；前台立即下架，排期与排序值保留。",
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<AdDto>(`/ads/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`广告「${row.title}」已删除`)
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

  function askRestore(row: AdDto) {
    setConfirm({
      open: true,
      title: `恢复广告「${row.title}」`,
      description: "恢复软删除行：保留原状态、排期与排序值。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<AdDto>(`/ads/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`广告「${row.title}」已恢复`)
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

  /** 预览：新窗口打开站内图片（永不自动访问外部跳转地址） */
  function preview(row: AdDto) {
    const src = resolveMediaSrc(row.imagePath)
    if (src) window.open(src, "_blank", "noopener,noreferrer")
  }

  const columns: Column<AdDto>[] = [
    {
      key: "image",
      header: "图片",
      width: "88px",
      render: (r) => <MediaPreview src={r.imagePath} alt={`广告 ${r.title} 缩略图`} />,
    },
    {
      key: "title",
      header: "标题",
      sortable: true,
      render: (r) => (
        <div className="flex min-w-40 flex-col gap-1">
          <span className="font-medium text-foreground">{r.title}</span>
          {r.deletedAt ? <DeletedPill /> : null}
        </div>
      ),
    },
    { key: "position", header: "位置", width: "72px", render: () => <span className="text-xs">首页</span> },
    {
      key: "targetUrl",
      header: "跳转地址",
      render: (r) => (
        <span className="block max-w-64 truncate font-mono text-xs text-muted-foreground" title={r.targetUrl}>
          {r.targetUrl}
        </span>
      ),
    },
    { key: "startsAt", header: "开始时间", sortable: true, width: "150px", render: (r) => <span className="text-xs">{formatTime(r.startsAt)}</span> },
    { key: "endsAt", header: "结束时间", sortable: true, width: "150px", render: (r) => <span className="text-xs">{formatTime(r.endsAt)}</span> },
    { key: "status", header: "状态", sortable: true, width: "90px", render: (r) => <AdStatusPill status={r.status} /> },
    { key: "effectiveStatus", header: "有效状态", width: "96px", render: (r) => <AdEffectivePill status={r.effectiveStatus} /> },
    { key: "sortOrder", header: "排序", sortable: true, align: "right", width: "64px" },
    { key: "updatedAt", header: "更新时间", sortable: true, width: "150px", render: (r) => <span className="text-xs">{formatTime(r.updatedAt)}</span> },
  ]

  function renderActions(r: AdDto) {
    if (r.deletedAt) {
      return (
        <div className="inline-flex items-center gap-1.5">
          <RowAction onClick={() => preview(r)} disabled={!r.imagePath} title="站内预览">
            预览
          </RowAction>
          {canDelete ? (
            <RowAction onClick={() => askRestore(r)} disabled={Boolean(busyId)} title="恢复">
              <Undo2 className="size-3.5" aria-hidden />
              恢复
            </RowAction>
          ) : null}
        </div>
      )
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
        <RowAction onClick={() => preview(r)} disabled={!r.imagePath} title="站内预览图片">
          预览
        </RowAction>
        {canUpdate
          ? STATUS_ACTIONS[r.status].map((a) => (
              <RowAction
                key={a.next}
                onClick={() => void changeStatus(r, a.label, a.next)}
                disabled={Boolean(busyId)}
                title={`${a.label}（status → ${a.next}）`}
              >
                {a.label}
              </RowAction>
            ))
          : null}
        {canUpdate ? (
          <>
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
            新增广告
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
        emptyTitle="暂无广告"
        emptyDescription="点击右上角「新增广告」创建第一条首页广告。"
        minTableWidth={1180}
        ariaLabel="广告列表"
      />

      <AdFormDialog
        open={dialogOpen}
        onOpenChange={closeDialog}
        record={editing}
        csrfToken={csrfToken}
        canUpdate={canUpdate}
        knownImagePaths={knownImagePaths}
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
