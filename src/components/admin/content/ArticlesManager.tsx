"use client"

// P6C：文章管理列表（服务端分页/排序/筛选 + 状态流转 + 软删除/恢复 + 编辑器子页入口）
// ─────────────────────────────────────────────────────────────────
// - 编辑走子页：/admin/articles/new、/admin/articles/[id]（富文本编辑器页面化，不用弹窗）
// - 状态机（与服务端一致）：draft→published / draft→archived / published→archived / archived→published
//   发布/归档需 articles.publish；列表行内直接流转（保存 version 随行数据）
// - 回收站 = 「含已删除」筛选；恢复保留原状态（服务端校验分类）
import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, Undo2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { ArticleDto, ArticleStatus, PageResult } from "@/lib/admin/dto/article"
import type { CategoryDto } from "@/lib/admin/dto/content"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import type { SelectOption } from "../forms/SelectField"
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
const STATUS_ACTIONS: Record<ArticleStatus, { label: string; next: ArticleStatus }[]> = {
  draft: [
    { label: "发布", next: "published" },
    { label: "归档", next: "archived" },
  ],
  published: [{ label: "归档", next: "archived" }],
  archived: [{ label: "重新发布", next: "published" }],
}

export function ArticlesManager({ csrfToken, canCreate, canUpdate, canPublish, canDelete }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "updatedAt", order: "desc" },
  })
  const [rows, setRows] = React.useState<ArticleDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [categoryOptions, setCategoryOptions] = React.useState<SelectOption[]>([])
  const [confirm, setConfirm] = React.useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // 筛选用分类选项（快照规模 <100，一页取满）
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const cats = await adminGet<PageResult<CategoryDto>>("/article-categories?pageSize=100&sortBy=sortOrder&sortDir=asc")
      if (cancelled || !cats.ok) return
      setCategoryOptions(
        cats.data.items.map((c) => ({ label: c.status === "disabled" ? `${c.name}（停用）` : c.name, value: c.id })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const sort = state.sort ?? { field: "updatedAt", order: "desc" as const }
    const res = await adminGet<PageResult<ArticleDto>>(
      `/articles${buildQuery({
        q: applied.q,
        categoryId: applied.categoryId,
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
    { key: "q", label: "关键词", type: "keyword", placeholder: "搜索标题 / 作者" },
    { key: "categoryId", label: "分类", type: "select", options: [{ label: "全部分类", value: "" }, ...categoryOptions] },
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

  async function changeStatus(row: ArticleDto, label: string, next: ArticleStatus) {
    setBusyId(row.id)
    const res = await adminPatch<ArticleDto>(`/articles/${row.id}/status`, { status: next, version: row.version }, { csrfToken })
    setBusyId(null)
    if (res.ok) {
      toast.success(`文章「${row.title}」已${label}`)
      void load()
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) void load()
    }
  }

  function askDelete(row: ArticleDto) {
    setConfirm({
      open: true,
      title: `删除文章「${row.title}」`,
      description: "软删除后可在「含已删除」视图恢复；前台立即下架，浏览量与发布时间保留。",
      confirmLabel: "删除",
      danger: true,
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminDelete<ArticleDto>(`/articles/${row.id}?version=${row.version}`, { csrfToken })
        if (res.ok) {
          toast.success(`文章「${row.title}」已删除`)
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

  function askRestore(row: ArticleDto) {
    setConfirm({
      open: true,
      title: `恢复文章「${row.title}」`,
      description: "将清除删除标记并保留原状态；所属分类不可用（或已发布文章分类停用）时恢复会被拒绝。",
      confirmLabel: "恢复",
      loading: false,
      onConfirm: async () => {
        setConfirm((c) => (c ? { ...c, loading: true } : c))
        const res = await adminPost<ArticleDto>(`/articles/${row.id}/restore`, { version: row.version }, { csrfToken })
        if (res.ok) {
          toast.success(`文章「${row.title}」已恢复`)
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

  const columns: Column<ArticleDto>[] = [
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
      key: "categoryName",
      header: "分类",
      width: "130px",
      render: (r) => <span className="truncate text-sm">{r.categoryName || <span className="text-muted-foreground/70">—</span>}</span>,
    },
    {
      key: "authorName",
      header: "作者",
      width: "110px",
      render: (r) => <span className="truncate text-sm text-muted-foreground">{r.authorName || "—"}</span>,
    },
    {
      key: "viewCount",
      header: "浏览",
      align: "right",
      sortable: true,
      width: "90px",
      render: (r) => <span className="tabular-nums">{r.viewCount}</span>,
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
          <PrimaryAction onClick={() => router.push("/admin/articles/new")}>
            <Plus className="size-4" aria-hidden />
            新建文章
          </PrimaryAction>
        ) : null}
      </div>

      <DataTable<ArticleDto>
        columns={columns}
        data={rows}
        total={total}
        rowKey={(r) => r.id}
        state={state}
        onStateChange={setState}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="暂无文章"
        emptyDescription="创建第一篇文章（保存为草稿），或调整筛选条件。"
        minTableWidth={1240}
        ariaLabel="文章列表"
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
                  <RowAction onClick={() => router.push(`/admin/articles/${r.id}`)} disabled={Boolean(busyId)}>
                    编辑
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
