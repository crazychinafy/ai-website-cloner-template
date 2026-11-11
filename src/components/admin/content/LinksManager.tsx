"use client"

// P6B：网址管理页（列表 + 分类/标签/状态筛选 + 三态状态流转 + 软删除/恢复 + 聚合编辑入口）
// ─────────────────────────────────────────────────────────────────
// - 数据源：/api/admin/v1/links（列表 DTO 自带 categoryName/tagName/clickCount/hasDetail）
// - 状态操作（发布/下架/停用）需 links.publish；删除/恢复需 links.delete（服务端同口径强校验）
// - 编辑弹窗打开前拉取聚合（GET /links/[id]：主行 + 详情 + 备用链接）
// - 回收站 = 「含已删除」筛选（includeDeleted=true，软删除行带徽章）；AUTO_INCREMENT 保证恢复/新建不冲突
import * as React from "react"
import { Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { LinkAggregateDto, LinkDto, LinkStatus } from "@/lib/admin/dto/link"
import type { CategoryDto, TagDto } from "@/lib/admin/dto/content"
import type { Column, FilterState, PageResult, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import type { SelectOption } from "../forms/SelectField"
import { DataTable } from "../tables/DataTable"
import { ConfirmDialog } from "../dialogs/ConfirmDialog"
import { useToast } from "../feedback/ToastProvider"
import { LinkFormDialog, type LinkFormValues } from "./LinkFormDialog"
import { buildQuery, DeletedPill, LinkStatusPill, PrimaryAction, RowAction, formatTime } from "./content-ui"

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

/** 与服务端状态机一致的流转表（disabled→draft 需先发布） */
const STATUS_ACTIONS: Record<LinkStatus, { label: string; next: LinkStatus }[]> = {
  draft: [
    { label: "发布", next: "published" },
    { label: "停用", next: "disabled" },
  ],
  published: [
    { label: "下架", next: "draft" },
    { label: "停用", next: "disabled" },
  ],
  disabled: [{ label: "发布", next: "published" }],
}

export function LinksManager({ csrfToken, canCreate, canUpdate, canPublish, canDelete }: Props) {
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "updatedAt", order: "desc" },
  })
  const [rows, setRows] = React.useState<LinkDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [categoryOptions, setCategoryOptions] = React.useState<SelectOption[]>([])
  const [tagOptions, setTagOptions] = React.useState<SelectOption[]>([])
  const [formOpen, setFormOpen] = React.useState(false)
  const [formValues, setFormValues] = React.useState<LinkFormValues | null>(null)
  const [formLoadingId, setFormLoadingId] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // 筛选/表单共用的分类与标签选项（快照规模：分类与标签均 <100，一页取满）
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [cats, tags] = await Promise.all([
        adminGet<PageResult<CategoryDto>>("/categories?pageSize=100&sortBy=sortOrder&sortDir=asc"),
        adminGet<PageResult<TagDto>>("/tags?pageSize=100&sortBy=sortOrder&sortDir=asc"),
      ])
      if (cancelled) return
      if (cats.ok) {
        setCategoryOptions(cats.data.items.map((c) => ({ label: c.status === "disabled" ? `${c.name}（停用）` : c.name, value: c.id })))
      }
      if (tags.ok) {
        setTagOptions(tags.data.items.map((t) => ({ label: t.status === "disabled" ? `${t.name}（停用）` : t.name, value: t.id })))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "updatedAt", order: "desc" as const }
    const res = await adminGet<PageResult<LinkDto>>(
      `/links${buildQuery({
        q: applied.q,
        categoryId: applied.categoryId,
        tagId: applied.tagId,
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
    { key: "q", label: "关键词", type: "keyword", placeholder: "搜索名称 / 地址 / 简介" },
    { key: "categoryId", label: "分类", type: "select", options: [{ label: "全部分类", value: "" }, ...categoryOptions] },
    { key: "tagId", label: "标签", type: "select", options: [{ label: "全部标签", value: "" }, ...tagOptions] },
    {
      key: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "全部状态", value: "" },
        { label: "草稿", value: "draft" },
        { label: "已发布", value: "published" },
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
    setFormValues({ mode: "create" })
    setFormOpen(true)
  }

  async function openEdit(row: LinkDto) {
    if (formLoadingId) return
    setFormLoadingId(row.id)
    const res = await adminGet<LinkAggregateDto>(`/links/${row.id}`)
    setFormLoadingId(null)
    if (!res.ok) {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
      return
    }
    setFormValues({ mode: "edit", record: res.data })
    setFormOpen(true)
  }

  async function changeStatus(row: LinkDto, label: string, next: LinkStatus) {
    setBusyId(row.id)
    const res = await adminPatch<LinkDto>(`/links/${row.id}/status`, { status: next, version: row.version }, { csrfToken })
    setBusyId(null)
    if (res.ok) {
      toast.success(`网址「${row.title}」已${label}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: LinkDto) {
    setConfirm({
      open: true,
      title: `删除网址「${row.title}」`,
      description: "软删除后可在「含已删除」视图恢复；详情补充与备用链接一并保留，前台立即下架。",
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<LinkDto>(`/links/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`网址「${row.title}」已删除`)
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

  function askRestore(row: LinkDto) {
    setConfirm({
      open: true,
      title: `恢复网址「${row.title}」`,
      description: "将清除删除标记并保留原状态；所属分类或标签已不可用时恢复会被拒绝。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<LinkDto>(`/links/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`网址「${row.title}」已恢复`)
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

  const columns: Column<LinkDto>[] = [
    {
      key: "title",
      header: "网址",
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground" title={r.title}>
            {r.title} {r.deletedAt ? <DeletedPill /> : null} {r.isGone ? <span className="text-xs text-warning">源站失效</span> : null}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.id}</p>
        </div>
      ),
    },
    {
      key: "url",
      header: "跳转地址",
      width: "260px",
      render: (r) => (
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate font-mono text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
          title={r.url}
        >
          {r.url}
        </a>
      ),
    },
    {
      key: "categoryName",
      header: "分类",
      width: "130px",
      render: (r) => <span className="truncate text-sm">{r.categoryName ?? <span className="text-muted-foreground/70">—</span>}</span>,
    },
    {
      key: "tagName",
      header: "标签",
      width: "110px",
      render: (r) => <span className="truncate text-sm">{r.tagName ?? <span className="text-muted-foreground/70">—</span>}</span>,
    },
    {
      key: "clickCount",
      header: "点击",
      align: "right",
      width: "80px",
      render: (r) => (
        <span className="tabular-nums" title={r.hasDetail ? undefined : "无详情行"}>
          {r.clickCount}
        </span>
      ),
    },
    { key: "sortOrder", header: "排序", sortable: true, align: "right", width: "72px", render: (r) => <span className="tabular-nums">{r.sortOrder}</span> },
    { key: "status", header: "状态", width: "96px", render: (r) => <LinkStatusPill status={r.status} /> },
    { key: "version", header: "版本", align: "right", width: "60px", render: (r) => <span className="font-mono text-xs">v{r.version}</span> },
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
          <PrimaryAction onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            新建网址
          </PrimaryAction>
        ) : null}
      </div>

      <DataTable<LinkDto>
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="暂无网址"
        emptyDescription="创建第一个网址（保存为草稿），或调整筛选条件。"
        minTableWidth={1260}
        ariaLabel="网址列表"
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
                  <RowAction onClick={() => void openEdit(r)} disabled={Boolean(busyId || formLoadingId)}>
                    {formLoadingId === r.id ? "载入" : "编辑"}
                  </RowAction>
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

      <LinkFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        csrfToken={csrfToken}
        values={formValues}
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
        canPublish={canPublish}
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
