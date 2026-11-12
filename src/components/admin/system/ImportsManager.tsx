"use client"

// P7：数据导入管理（系统管理组；imports.preview 查看 / imports.execute 执行）
// ─────────────────────────────────────────────────────────────────
// - 预览：POST /imports/preview（零写入：只 SELECT；返回服务端可信 snapshotVersion + checksum + 13 表差异）
// - 执行：POST /imports —— 必须携带预览回执（version+checksum）、手输库名二次确认、
//         生产环境需勾选确认 + 服务端 ADMIN_IMPORT_ALLOW_PRODUCTION=1；并发互斥由 MySQL 命名锁保证（409）
// - 历史：GET /imports（只读；CLI 记录 startedBy=null 显示「CLI」；errorSummary 已脱敏截断）
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { RefreshCw } from "lucide-react"
import { adminGet, adminPost, type AdminApiError } from "@/lib/admin/ui/api-client"
import type { ImportExecuteDto, ImportPreviewDto, ImportRunDto } from "@/lib/admin/dto/import"
import type { ImportTableDiffDto } from "@/lib/admin/dto/import"
import type { PageResult } from "@/lib/admin/dto/content"
import type { Column, FilterState, TableState } from "../types/table"
import { defaultTableState } from "../types/table"
import { SearchToolbar, type SearchFieldDef } from "../forms/SearchToolbar"
import { DataTable } from "../tables/DataTable"
import { useToast } from "../feedback/ToastProvider"
import { StatusBadge } from "../feedback/StatusBadge"
import { buildQuery, formatTime, PrimaryAction, RowAction, SecondaryAction } from "../content/content-ui"

interface Props {
  csrfToken: string
  canExecute: boolean
}

function RunStatusPill({ status }: { status: ImportRunDto["status"] }) {
  if (status === "succeeded") return <StatusBadge tone="success">成功</StatusBadge>
  if (status === "failed") return <StatusBadge tone="danger">失败</StatusBadge>
  if (status === "running") return <StatusBadge tone="info">执行中</StatusBadge>
  if (status === "cancelled") return <StatusBadge tone="neutral">已取消</StatusBadge>
  return <StatusBadge tone="neutral">待执行</StatusBadge>
}

function ModePill({ mode }: { mode: ImportRunDto["mode"] }) {
  return mode === "import" ? (
    <StatusBadge tone="info" dot={false}>导入</StatusBadge>
  ) : (
    <StatusBadge tone="neutral" dot={false}>试运行</StatusBadge>
  )
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: "danger" | "warning" | "info" }) {
  if (value === 0) return null
  return <StatusBadge tone={tone} dot={false}>{label} {value}</StatusBadge>
}

function IdList({ title, ids, total }: { title: string; ids: string[]; total: number }) {
  if (total === 0) return null
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      <span className="font-medium text-foreground">{title}（共 {total}）：</span>
      {ids.join("、")}
      {total > ids.length ? " …（已截断）" : ""}
    </p>
  )
}

function TableDiffCard({ t }: { t: ImportTableDiffDto }) {
  const orderNote =
    t.orderChanged === null ? null : t.orderChanged ? `顺序不一致（差异位置 ${t.orderDiffPositions} 个）` : "顺序一致"
  return (
    <div className="rounded-md border border-border/70 bg-background/60 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        {t.label}
        <span className="font-mono text-xs font-normal text-muted-foreground">{t.tableId}</span>
        {t.ok ? <StatusBadge tone="success" dot={false}>一致</StatusBadge> : <StatusBadge tone="warning" dot={false}>有差异</StatusBadge>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        快照 {t.snapshotCount.toLocaleString("zh-CN")} 行 · 当前库 {t.dbCount.toLocaleString("zh-CN")} 行
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <CountChip label="缺失" value={t.missingTotal} tone="danger" />
        <CountChip label="多余" value={t.extraTotal} tone="warning" />
        <CountChip label="字段不同" value={t.changedTotal} tone="info" />
        <CountChip label="关系错误" value={t.relationErrorTotal} tone="danger" />
        {t.orderChanged ? <StatusBadge tone="warning" dot={false}>顺序不一致</StatusBadge> : null}
      </div>
      {!t.ok ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">查看差异明细</summary>
          <div className="mt-1.5 space-y-1">
            <IdList title="缺失（快照有、库里没有）" ids={t.missing} total={t.missingTotal} />
            <IdList title="多余（库里有、快照没有）" ids={t.extra} total={t.extraTotal} />
            {t.changedTotal > 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                <span className="font-medium text-foreground">字段不同（共 {t.changedTotal}）：</span>
                {t.changedFields.map((c) => `${c.id}: ${c.fields.join(", ")}`).join("；")}
                {t.changedTotal > t.changedFields.length ? " …（已截断）" : ""}
              </p>
            ) : null}
            <IdList title="关系错误" ids={t.relationErrors} total={t.relationErrorTotal} />
            {orderNote ? <p className="text-xs text-muted-foreground">{orderNote}</p> : null}
            {t.truncated ? <p className="text-xs text-muted-foreground">差异列表按上限截断展示；统计数字为全量。</p> : null}
          </div>
        </details>
      ) : null}
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

function RunDetailDialog({ run, onClose }: { run: ImportRunDto; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()} modal>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup className="adm-dialog flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-base font-semibold text-foreground">导入记录 #{run.id}</Dialog.Title>
              <RowAction onClick={onClose} aria-label="关闭详情">关闭</RowAction>
            </div>
            <Dialog.Description className="sr-only">导入记录详情（只读）</Dialog.Description>
            <div className="admin-scroll mt-4 min-h-0 flex-1 overflow-y-auto">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <DetailField label="状态"><RunStatusPill status={run.status} /></DetailField>
                <DetailField label="模式"><ModePill mode={run.mode} /></DetailField>
                <DetailField label="快照版本">{run.snapshotVersion}</DetailField>
                <DetailField label="校验和"><span className="font-mono text-xs">{run.checksum ?? "—"}</span></DetailField>
                <DetailField label="开始时间（UTC）">{formatTime(run.startedAt)}</DetailField>
                <DetailField label="结束时间（UTC）">{formatTime(run.finishedAt)}</DetailField>
                <DetailField label="发起人">
                  {run.startedByUsername ? (
                    <span className="font-mono text-xs">@{run.startedByUsername}</span>
                  ) : run.startedByDeleted ? (
                    <StatusBadge tone="warning" dot={false}>已删除管理员</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral" dot={false}>CLI（无管理员上下文）</StatusBadge>
                  )}
                </DetailField>
                <DetailField label="导入行数">{run.summary?.total?.toLocaleString("zh-CN") ?? "—"}</DetailField>
              </dl>
              {run.summary?.counts ? (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">各表写入行数</p>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                    {Object.entries(run.summary.counts).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{k}</span>
                        <span className="tabular-nums text-foreground">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.errorSummary ? (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium text-destructive">失败摘要（已脱敏截断）</p>
                  <pre className="admin-scroll max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-all">
                    {run.errorSummary}
                  </pre>
                </div>
              ) : null}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ImportsManager({ csrfToken, canExecute }: Props) {
  const { toast } = useToast()
  const [preview, setPreview] = React.useState<ImportPreviewDto | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(true)
  const [previewError, setPreviewError] = React.useState<AdminApiError | string | null>(null)

  const [execOpen, setExecOpen] = React.useState(false)
  const [confirmDatabase, setConfirmDatabase] = React.useState("")
  const [confirmProduction, setConfirmProduction] = React.useState(false)
  const [executing, setExecuting] = React.useState(false)
  const [execError, setExecError] = React.useState<AdminApiError | string | null>(null)
  const [result, setResult] = React.useState<ImportExecuteDto | null>(null)

  const [filter, setFilter] = React.useState<FilterState>({})
  const [applied, setApplied] = React.useState<FilterState>({})
  const [state, setState] = React.useState<TableState>({
    ...defaultTableState(),
    sort: { field: "startedAt", order: "desc" },
  })
  const [runs, setRuns] = React.useState<ImportRunDto[]>([])
  const [runsTotal, setRunsTotal] = React.useState(0)
  const [runsLoading, setRunsLoading] = React.useState(true)
  const [runsError, setRunsError] = React.useState<AdminApiError | string | null>(null)
  const [detail, setDetail] = React.useState<ImportRunDto | null>(null)

  const loadPreview = React.useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    const res = await adminPost<ImportPreviewDto>("/imports/preview", {}, { csrfToken })
    if (res.ok) setPreview(res.data)
    else setPreviewError(res.error)
    setPreviewLoading(false)
  }, [csrfToken])

  React.useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  React.useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setRunsLoading(true)
    setRunsError(null)
    const qs = buildQuery({
      q: applied.q,
      mode: applied.mode,
      status: applied.status,
      page: state.pagination.page,
      pageSize: state.pagination.pageSize,
      sortBy: state.sort?.field ?? "startedAt",
      sortDir: state.sort?.order ?? "desc",
    })
    adminGet<PageResult<ImportRunDto>>(`/imports${qs}`, { signal: ctrl.signal }).then((res) => {
      if (!alive) return
      if (res.ok) {
        setRuns(res.data.items)
        setRunsTotal(res.data.total)
      } else {
        setRunsError(res.error)
      }
      setRunsLoading(false)
    })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [applied, state])

  function openExec() {
    setConfirmDatabase("")
    setConfirmProduction(false)
    setExecError(null)
    setExecOpen(true)
  }

  async function runExecute() {
    if (!preview || executing) return
    setExecuting(true)
    setExecError(null)
    const res = await adminPost<ImportExecuteDto>(
      "/imports",
      {
        snapshotVersion: preview.snapshotVersion,
        checksum: preview.checksum,
        confirmDatabase: confirmDatabase.trim(),
        confirmProduction,
      },
      { csrfToken },
    )
    setExecuting(false)
    if (res.ok) {
      setResult(res.data)
      setExecOpen(false)
      toast.success(res.data.message)
      void loadPreview()
      setApplied((a) => ({ ...a }))
    } else {
      setExecError(res.error)
    }
  }

  const historyFields: SearchFieldDef[] = [
    { key: "q", label: "关键词", type: "keyword", placeholder: "快照版本 / 校验和" },
    {
      key: "mode",
      label: "模式",
      type: "select",
      options: [
        { label: "全部", value: "" },
        { label: "导入", value: "import" },
        { label: "试运行", value: "dry_run" },
      ],
    },
    {
      key: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "全部", value: "" },
        { label: "成功", value: "succeeded" },
        { label: "失败", value: "failed" },
        { label: "执行中", value: "running" },
        { label: "待执行", value: "pending" },
        { label: "已取消", value: "cancelled" },
      ],
    },
  ]

  const runColumns: Column<ImportRunDto>[] = [
    { key: "id", header: "ID", sortable: true, width: "70px", render: (r) => <span className="font-mono text-xs">#{r.id}</span> },
    { key: "startedAt", header: "开始时间（UTC）", sortable: true, width: "170px", render: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.startedAt}</span> },
    { key: "version", header: "快照版本", width: "120px", render: (r) => <span className="text-xs">{r.snapshotVersion}</span> },
    { key: "mode", header: "模式", width: "90px", render: (r) => <ModePill mode={r.mode} /> },
    { key: "status", header: "状态", width: "100px", render: (r) => <RunStatusPill status={r.status} /> },
    {
      key: "actor",
      header: "发起人",
      width: "130px",
      render: (r) =>
        r.startedByUsername ? (
          <span className="font-mono text-xs">@{r.startedByUsername}</span>
        ) : r.startedByDeleted ? (
          <StatusBadge tone="warning" dot={false}>已删除管理员</StatusBadge>
        ) : (
          <StatusBadge tone="neutral" dot={false}>CLI</StatusBadge>
        ),
    },
    { key: "total", header: "行数", width: "80px", align: "right", render: (r) => <span className="text-xs tabular-nums">{r.summary?.total ?? "—"}</span> },
    {
      key: "error",
      header: "失败摘要",
      render: (r) =>
        r.errorSummary ? (
          <span className="line-clamp-2 text-xs text-destructive" title={r.errorSummary}>
            {r.errorSummary}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* 结果横幅（上一次执行结论；no-op 也明确引用历史记录） */}
      {result ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${result.outcome === "imported" ? "border-success/40 bg-success-soft text-success" : "border-border bg-muted/50 text-foreground"}`}
          role="status"
        >
          {result.message}
          <button type="button" className="ml-3 text-xs underline" onClick={() => setResult(null)}>
            知道了
          </button>
        </div>
      ) : null}

      {/* 预览面板 */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">静态快照导入预览（只读 · 零写入）</h2>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryAction onClick={() => void loadPreview()} disabled={previewLoading} aria-label="重新生成预览">
              <RefreshCw className={`size-4 ${previewLoading ? "animate-spin" : ""}`} aria-hidden />
              重新预览
            </SecondaryAction>
            {canExecute ? (
              <PrimaryAction
                onClick={openExec}
                disabled={!preview || !preview.executable || previewLoading}
                title={!preview || previewLoading ? "预览生成后可执行" : preview && !preview.executable ? preview.blockedReason ?? "当前不可执行" : undefined}
              >
                {preview?.noOpMatched ? "再次执行（预期 no-op）" : "执行导入…"}
              </PrimaryAction>
            ) : (
              <span className="text-xs text-muted-foreground">无 imports.execute 权限：仅可预览与查看历史</span>
            )}
          </div>
        </div>

        {previewError ? (
          <p className="mt-3 text-sm text-destructive">
            预览失败：{typeof previewError === "string" ? previewError : previewError.message}
          </p>
        ) : previewLoading && !preview ? (
          <p className="mt-3 text-sm text-muted-foreground">正在生成预览（只执行 SELECT，不写入任何数据）…</p>
        ) : preview ? (
          <div className="mt-3 space-y-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
              <DetailField label="快照版本（服务端可信）">{preview.snapshotVersion}</DetailField>
              <DetailField label="校验和（服务端实时计算）">
                <span className="font-mono text-xs break-all">{preview.checksum}</span>
              </DetailField>
              <DetailField label="目标数据库（执行时需手输确认）">
                <span className="font-mono text-xs">{preview.targetDatabase}</span>
              </DetailField>
              <DetailField label="快照行数 / 当前库行数">
                <span className="tabular-nums">
                  {preview.snapshotTotal.toLocaleString("zh-CN")} / {preview.dbTotal.toLocaleString("zh-CN")}
                </span>{" "}
                <span className="text-xs text-muted-foreground">（内容表{preview.dbState === "empty" ? "为空" : "已有数据"}）</span>
              </DetailField>
              <DetailField label="上次成功导入">
                {preview.priorSucceeded ? (
                  <span className="text-xs">
                    #{preview.priorSucceeded.id} · {preview.priorSucceeded.startedAt}（UTC）
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">无</span>
                )}
              </DetailField>
              <DetailField label="生产环境">
                {preview.isProduction ? (
                  preview.productionAllowed ? (
                    <StatusBadge tone="warning" dot={false}>生产环境（已授权导入）</StatusBadge>
                  ) : (
                    <StatusBadge tone="danger" dot={false}>生产环境（未授权：需 ADMIN_IMPORT_ALLOW_PRODUCTION=1）</StatusBadge>
                  )
                ) : (
                  <StatusBadge tone="neutral" dot={false}>非生产环境</StatusBadge>
                )}
              </DetailField>
            </dl>

            {preview.blockedReason ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                当前不可执行导入：{preview.blockedReason}
              </p>
            ) : preview.noOpMatched ? (
              <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                该快照已成功导入过（记录 {preview.priorSucceeded ? `#${preview.priorSucceeded.id}` : "未知"}）；
                再次执行将走安全 no-op（不重复写入，不产生新导入记录，但会在操作日志留痕并引用历史记录）。
              </p>
            ) : (
              <p className="rounded-md border border-success/40 bg-success-soft px-3 py-2 text-sm text-success">
                可以执行：将把快照 {preview.snapshotTotal.toLocaleString("zh-CN")} 行写入 {preview.targetDatabase} 的 13 张内容表。
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              预览生成时间（UTC）：{preview.generatedAt} · 差异明细列表按上限截断，统计为全量。
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {preview.tables.map((t) => (
                <TableDiffCard key={t.tableId} t={t} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* 历史记录 */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">导入历史（admin_import_runs · 只读；含 CLI 记录）</h2>
        <SearchToolbar fields={historyFields} value={filter} onChange={setFilter} onSearch={(next) => { setApplied(next); setState((s) => ({ ...s, pagination: { ...s.pagination, page: 1 }, filter: next })) }} loading={runsLoading} />
        <DataTable
          columns={runColumns}
          data={runs}
          total={runsTotal}
          rowKey={(r) => r.id}
          state={state}
          onStateChange={setState}
          loading={runsLoading}
          error={runsError}
          onRetry={() => setApplied((a) => ({ ...a }))}
          onRowClick={(r) => setDetail(r)}
          renderRowActions={(r) => (
            <RowAction onClick={(e) => { e.stopPropagation(); void (async () => {
              const res = await adminGet<ImportRunDto>(`/imports/${r.id}`)
              if (res.ok) setDetail(res.data)
              else toast.error(`读取详情失败：${res.error.message}`)
            })() }}>
              详情
            </RowAction>
          )}
          emptyTitle="暂无导入记录"
          emptyDescription="尚无导入记录；P4 CLI 与后台执行都会在这里留痕。"
          minTableWidth={900}
          ariaLabel="导入历史列表"
        />
      </section>

      {detail ? <RunDetailDialog run={detail} onClose={() => setDetail(null)} /> : null}

      {/* 执行确认（二次确认：手输库名 + 生产勾选） */}
      {execOpen && preview ? (
        <Dialog.Root open onOpenChange={(next) => !next && !executing && setExecOpen(false)} modal>
          <Dialog.Portal>
            <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
            <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <Dialog.Popup className="adm-dialog w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
                <Dialog.Title className="text-base font-semibold text-foreground">执行静态数据导入</Dialog.Title>
                <Dialog.Description className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                  将把快照 <span className="font-mono text-foreground">{preview.snapshotVersion}</span>（
                  {preview.snapshotTotal.toLocaleString("zh-CN")} 行 / 13 表）写入数据库
                  <span className="font-mono text-foreground"> {preview.targetDatabase} </span>。
                  {preview.noOpMatched ? "已存在同版本同校验和的成功记录：本次执行预期为安全 no-op。" : "单事务写入；任何一步失败整体回滚。"}
                </Dialog.Description>
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="exec-db" className="mb-1 block text-sm font-medium text-foreground">
                      二次确认：输入目标数据库名
                    </label>
                    <input
                      id="exec-db"
                      type="text"
                      value={confirmDatabase}
                      onChange={(e) => setConfirmDatabase(e.target.value)}
                      placeholder={preview.targetDatabase}
                      autoComplete="off"
                      spellCheck={false}
                      className="adm-touch-target h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">必须与服务器当前库名完全一致（不会自动填充，防止盲执行）。</p>
                  </div>
                  {preview.isProduction ? (
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={confirmProduction}
                        onChange={(e) => setConfirmProduction(e.target.checked)}
                        className="mt-1 size-4 accent-primary"
                      />
                      我确认这是生产环境导入（还需服务端 ADMIN_IMPORT_ALLOW_PRODUCTION=1）
                    </label>
                  ) : null}
                  {execError ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      {typeof execError === "string" ? execError : `${execError.code ? `${execError.code}：` : ""}${execError.message}`}
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-row-reverse gap-3">
                  <PrimaryAction
                    onClick={() => void runExecute()}
                    disabled={executing || confirmDatabase.trim() === "" || (preview.isProduction && !confirmProduction)}
                  >
                    {executing ? "导入执行中…" : "确认执行"}
                  </PrimaryAction>
                  <SecondaryAction onClick={() => setExecOpen(false)} disabled={executing}>
                    取消
                  </SecondaryAction>
                </div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  )
}
