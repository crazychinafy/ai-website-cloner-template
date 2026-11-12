"use client"

// P7：操作日志（审计）列表 —— 只读（系统管理组，audit_logs.read）
// ─────────────────────────────────────────────────────────────────
// - 数据源：GET /audit-logs（服务端分页/排序白名单/过滤；日志不可编辑、不可删除，故无任何写操作）
// - 操作人：账号已删除显示「已删除管理员」（服务端 leftJoin，日志行绝不因 JOIN 失败丢失）
// - 详情弹窗：before/after 已脱敏 JSON，以纯文本 <pre> 展示（不用 innerHTML，无 XSS 面）
// - IP：服务端已从 VARBINARY(16) 解码为文本（IPv4 / IPv6 / 映射地址）
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminGet, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { AuditFilterOptionsDto, AuditLogDto } from "@/lib/admin/dto/audit"
import type { PageResult } from "@/lib/admin/dto/content"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { buildQuery, formatTime, RowAction } from "../content/content-ui"
import { StatusBadge } from "../feedback/StatusBadge"

interface Props {
  /** 服务端 DISTINCT 真实筛选项（页面加载时抓取；DB 异常时为空数组不阻塞列表） */
  options: AuditFilterOptionsDto
}

/** 操作人展示：正常用户名 / 已删除管理员 / 未知 */
function ActorCell({ row }: { row: AuditLogDto }) {
  if (row.actorUsername) return <span className="font-mono text-xs text-foreground">@{row.actorUsername}</span>
  if (row.actorDeleted) return <StatusBadge tone="warning" dot={false}>已删除管理员</StatusBadge>
  return <span className="text-xs text-muted-foreground">—</span>
}

/** 变更快照 JSON 展示（脱敏后纯文本；空值占位；超长内部滚动） */
function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const empty = value === null || value === undefined
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {empty ? (
        <p className="text-xs text-muted-foreground/70">—</p>
      ) : (
        <pre className="admin-scroll max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-foreground">{children}</dd>
    </div>
  )
}

function AuditDetailDialog({ row, onClose }: { row: AuditLogDto; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()} modal>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup className="adm-dialog flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-base font-semibold text-foreground">
                操作日志 #{row.id}
              </Dialog.Title>
              <RowAction onClick={onClose} aria-label="关闭详情">
                关闭
              </RowAction>
            </div>
            <Dialog.Description className="mt-1 text-xs text-muted-foreground">
              只读记录：审计日志不提供编辑、删除或清理入口；before/after 已由服务端统一脱敏。
            </Dialog.Description>
            <div className="admin-scroll mt-4 min-h-0 flex-1 overflow-y-auto space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <DetailField label="时间（UTC）">{formatTime(row.createdAt)}</DetailField>
                <DetailField label="操作人">
                  <ActorCell row={row} />
                  {row.actorUserId ? <span className="ml-2 text-xs text-muted-foreground">#{row.actorUserId}</span> : null}
                </DetailField>
                <DetailField label="操作类型">
                  <span className="font-mono text-xs">{row.action}</span>
                </DetailField>
                <DetailField label="资源">
                  <span className="font-mono text-xs">
                    {row.resourceType}
                    {row.resourceId ? ` #${row.resourceId}` : ""}
                  </span>
                </DetailField>
                <DetailField label="请求 ID">
                  <span className="font-mono text-xs">{row.requestId ?? "—"}</span>
                </DetailField>
                <DetailField label="IP 地址">
                  <span className="font-mono text-xs">{row.ipAddress ?? "未知"}</span>
                </DetailField>
                <DetailField label="User-Agent">
                  <span className="break-all text-xs text-muted-foreground">{row.userAgent ?? "—"}</span>
                </DetailField>
              </dl>
              <JsonBlock title="变更前（before_json，已脱敏）" value={row.before} />
              <JsonBlock title="变更后（after_json，已脱敏）" value={row.after} />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function AuditLogsManager({ options }: Props) {
  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "createdAt", order: "desc" },
  })
  const [rows, setRows] = React.useState<AuditLogDto[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<AdminApiError | string | null>(null)
  const [detail, setDetail] = React.useState<AuditLogDto | null>(null)

  React.useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)
    const qs = buildQuery({
      q: applied.q,
      actorUserId: applied.actorUserId,
      action: applied.action,
      resourceType: applied.resourceType,
      page: state.pagination.page,
      pageSize: state.pagination.pageSize,
      sortBy: state.sort?.field ?? "createdAt",
      sortDir: state.sort?.order ?? "desc",
    })
    adminGet<PageResult<AuditLogDto>>(`/audit-logs${qs}`, { signal: ctrl.signal }).then((res) => {
      if (!alive) return
      if (res.ok) {
        setRows(res.data.items)
        setTotal(res.data.total)
      } else {
        setError(res.error)
      }
      setLoading(false)
    })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [applied, state])

  function onSearch(next: FilterState) {
    setApplied(next)
    setState((s) => ({ ...s, pagination: { ...s.pagination, page: 1 }, filter: next }))
  }

  function setDraftField(key: string, value: string) {
    setFilter((f) => {
      const merged: FilterState = { ...f }
      if (value === "") delete merged[key]
      else merged[key] = value
      return merged
    })
  }

  const fields: SearchFieldDef[] = [
    { key: "q", label: "关键词", type: "keyword", placeholder: "操作 / 资源 ID / 请求 ID / 用户名" },
    {
      key: "actorUserId",
      label: "操作人",
      type: "select",
      options: [
        { label: "全部", value: "" },
        ...options.actors.map((a) => ({ label: a.username, value: a.id })),
      ],
    },
    {
      key: "action",
      label: "操作类型",
      type: "select",
      options: [{ label: "全部", value: "" }, ...options.actions.map((a) => ({ label: a, value: a }))],
    },
    {
      key: "resourceType",
      label: "资源类型",
      type: "select",
      options: [{ label: "全部", value: "" }, ...options.resourceTypes.map((t) => ({ label: t, value: t }))],
    },
  ]

  const columns: Column<AuditLogDto>[] = [
    { key: "createdAt", header: "时间（UTC）", sortable: true, width: "170px", render: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.createdAt}</span> },
    { key: "actor", header: "操作人", width: "150px", render: (r) => <ActorCell row={r} /> },
    { key: "action", header: "操作", width: "160px", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    {
      key: "resource",
      header: "资源",
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground break-all">
          {r.resourceType}
          {r.resourceId ? ` #${r.resourceId}` : ""}
        </span>
      ),
    },
    { key: "ip", header: "IP", width: "140px", render: (r) => <span className="font-mono text-xs">{r.ipAddress ?? "未知"}</span> },
    {
      key: "requestId",
      header: "请求 ID",
      width: "120px",
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.requestId ? `${r.requestId.slice(0, 8)}…` : "—"}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <SearchToolbar
          fields={fields}
          value={filter}
          onChange={setFilter}
          onSearch={onSearch}
          loading={loading}
          className="min-w-0 flex-1"
        />
        {/* 日期范围（服务端按 UTC 墙钟日界过滤；改完点「搜索」生效） */}
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="audit-start" className="mb-1 block text-xs text-muted-foreground">
              开始日期
            </label>
            <input
              id="audit-start"
              type="date"
              value={filter.startDate ?? ""}
              onChange={(e) => setDraftField("startDate", e.target.value)}
              className="adm-touch-target h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <span className="pb-2 text-xs text-muted-foreground">—</span>
          <div>
            <label htmlFor="audit-end" className="mb-1 block text-xs text-muted-foreground">
              结束日期
            </label>
            <input
              id="audit-end"
              type="date"
              value={filter.endDate ?? ""}
              onChange={(e) => setDraftField("endDate", e.target.value)}
              className="adm-touch-target h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>
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
        onRetry={() => setApplied((a) => ({ ...a }))}
        onRowClick={(r) => setDetail(r)}
        renderRowActions={(r) => (
          <RowAction onClick={(e) => { e.stopPropagation(); setDetail(r) }}>详情</RowAction>
        )}
        emptyTitle="暂无日志"
        emptyDescription="当前筛选条件下没有操作记录。"
        minTableWidth={860}
        ariaLabel="操作日志列表"
      />

      {detail ? <AuditDetailDialog row={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
