"use client"

// P6C：公告管理列表（服务端分页/排序/筛选 + 状态流转 + 软删除/恢复 + 上移/下移排序 + 编辑器子页入口）
// ─────────────────────────────────────────────────────────────────
// - 编辑走子页：/admin/bulletins/new、/admin/bulletins/[id]
// - 状态机（与服务端一致）：draft→published / draft→archived / published→archived / archived→published
//   发布/归档需 bulletins.publish
// - 排序：上移/下移与当前页相邻行交换 sortOrder，POST /bulletins/reorder（单事务 + 逐行乐观锁，
//   任一版本冲突整批回滚）；仅在默认「排序值」视角下语义直观
// - 回收站 = 「含已删除」筛选；恢复保留原状态
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { BulletinDto, BulletinStatus, PageResult } from "@/lib/admin/dto/bulletin"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { ArticleStatusPill, buildQuery, DeletedPill, PrimaryAction, RowAction, formatTime } from "./content-ui"

interface Props {
  csrfToken: string
  canCreate: boolean
  canUpdate: boolean
  canPublish: boolean
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

/** 与服务端状态机一致（published→draft 撤回禁止；归档即「下架」） */
const STATUS_ACTIONS: Record<BulletinStatus, { label: string; next: BulletinStatus }[]> = {
  draft: [
    { label: "发布", next: "published" },
    { label: "归档", next: "archived" },
  ],
  published: [{ label: "归档", next: "archived" }],
  archived: [{ label: "重新发布", next: "published" }],
}

export function BulletinsManager({ csrfToken, canCreate, canUpdate, canPublish, canDelete }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "sortOrder", order: "asc" },
  })
  const [rows, setRows] = React.useState<BulletinDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "sortOrder", order: "asc" as const }
    const res = await adminGet<PageResult<BulletinDto>>(
      `/bulletins${buildQuery({
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
    { key: "q", label: "关键词", type: "keyword", placeholder: "搜索标题" },
    {
      key: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "全部状态", value: "" },
        { label: "草稿", value: "draft" },
        { label: "已发布", value: "published" },
        { label: "已归档", value: "archived" },
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

  async function changeStatus(row: BulletinDto, label: string, next: BulletinStatus) {
    setBusyId(row.id)
    const res = await adminPatch<BulletinDto>(
      `/bulletins/${row.id}/status`,
      { status: next, version: row.version },
      { csrfToken },
    )
    setBusyId(null)
    if (res.ok) {
      toast.success(`公告「${row.title}」已${label}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  /** 上移/下移：与当前页相邻行交换 sortOrder（两行都携带各自 version，服务端逐行校验） */
  async function move(row: BulletinDto, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === row.id)
    const other = rows[idx + dir]
    if (idx < 0 || !other) return
    setBusyId(row.id)
    const res = await adminPost<BulletinDto[]>(
      "/bulletins/reorder",
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
      toast.success(`公告「${row.title}」已${dir === -1 ? "上移" : "下移"}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: BulletinDto) {
    setConfirm({
      open: true,
      title: `删除公告「${row.title}」`,
      description: "软删除后可在「含已删除」视图恢复；前台立即下架，发布时间与排序值保留。",
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<BulletinDto>(`/bulletins/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`公告「${row.title}」已删除`)
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

  function askRestore(row: BulletinDto) {
    setConfirm({
      open: true,
      title: `恢复公告「${row.title}」`,
      description: "将清除删除标记并保留原状态与排序值。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<BulletinDto>(`/bulletins/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`公告「${row.title}」已恢复`)
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

  const sortedBySortOrder = state.sort?.field === "sortOrder"
  const columns: Column<BulletinDto>[] = [
    {
      key: "title",
      header: "标题",
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground" title={r.title}>
            {r.title} {r.deletedAt ? <DeletedPill /> : null}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.id}</p>
        </div>
      ),
    },
    {
      key: "sortOrder",
      header: "排序值",
      align: "right",
      sortable: true,
      width: "90px",
      render: (r) => <span className="tabular-nums">{r.sortOrder}</span>,
    },
    { key: "status", header: "状态", width: "96px", render: (r) => <ArticleStatusPill status={r.status} /> },
    { key: "version", header: "版本", align: "right", width: "60px", render: (r) => <span className="font-mono text-xs">v{r.version}</span> },
    {
      key: "publishedAt",
      header: "发布时间",
      sortable: true,
      width: "168px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.publishedAt)}</span>,
    },
    {
      key: "updatedAt",
      header: "更新时间",
      sortable: true,
      width: "168px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatTime(r.updatedAt)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchToolbar
          fields={fields}
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
          <PrimaryAction onClick={() => router.push("/admin/bulletins/new")}>
            <Plus className="size-4" aria-hidden />
            新建公告
          </PrimaryAction>
        ) : null}
      </div>

      {!sortedBySortOrder ? (
        <p className="text-xs text-muted-foreground">提示：上移/下移按当前页相邻行交换排序值，在「排序值」升序视角下语义最直观。</p>
      ) : null}

      <DataTable<BulletinDto>
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="暂无公告"
        emptyDescription="创建第一条公告（保存为草稿），或调整筛选条件。"
        minTableWidth={1160}
        ariaLabel="公告列表"
        renderRowActions={(r) => (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {r.deletedAt ? (
              canDelete ? (
                <RowAction onClick={() => askRestore(r)} disabled={Boolean(busyId)}>
                  <Undo2 className="size-3.5" aria-hidden />
                  恢复
                </RowAction>
              ) : null
            ) : (
              <>
                {canUpdate ? (
                  <>
                    <RowAction
                      onClick={() => void move(r, -1)}
                      disabled={Boolean(busyId) || rows.findIndex((x) => x.id === r.id) <= 0}
                      aria-label={`上移 ${r.title}`}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </RowAction>
                    <RowAction
                      onClick={() => void move(r, 1)}
                      disabled={
                        Boolean(busyId) ||
                        (() => {
                          const i = rows.findIndex((x) => x.id === r.id)
                          return i < 0 || i >= rows.length - 1
                        })()
                      }
                      aria-label={`下移 ${r.title}`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </RowAction>
                    <RowAction onClick={() => router.push(`/admin/bulletins/${r.id}`)} disabled={Boolean(busyId)}>
                      编辑
                    </RowAction>
                  </>
                ) : null}
                {canPublish
                  ? STATUS_ACTIONS[r.status].map((a) => (
                      <RowAction
                        key={a.next}
                        onClick={() => void changeStatus(r, a.label, a.next)}
                        loading={busyId === r.id}
                        disabled={Boolean(busyId)}
                      >
                        {a.label}
                      </RowAction>
                    ))
                  : null}
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
