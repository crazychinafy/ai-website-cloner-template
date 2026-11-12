"use client"

// P6D：线路 新建/编辑 表单弹窗（§11.4：name / url / sortOrder + 状态启停）
// ─────────────────────────────────────────────────────────────────
// - 新建默认「停用」（服务端强制）；编辑弹窗内嵌 启用/停用 按钮（lines.update），
//   走 PATCH /lines/[id]/status 并同步本地 version，避免随后保存版本冲突
// - URL 只做服务端语法校验（完整 http(s)）；保存时不发任何服务端探测请求（§6.7），
//   可达性属前台浏览器侧探测
// - PATCH 不含 status（状态只走 /status 端点）；字段错误来自服务端 Zod 信封（leaf 键）
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { LineDto, LineStatus } from "@/lib/admin/dto/line"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { RowAction, StatusPill } from "./content-ui"

export interface LineFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 新建 */
  record: LineDto | null
  csrfToken: string
  /** 编辑弹窗内嵌状态流转按钮所需（lines.update） */
  canUpdate: boolean
  /** 任意写操作成功后回传最新行 */
  onSaved: (record: LineDto) => void
}

export function LineFormDialog({ open, onOpenChange, record, csrfToken, canUpdate, onSaved }: LineFormDialogProps) {
  const { toast } = useToast()
  const isEdit = Boolean(record)
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [sortOrder, setSortOrder] = React.useState("")
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | undefined>(undefined)
  const [submitting, setSubmitting] = React.useState(false)
  const [status, setStatus] = React.useState<LineStatus>(record?.status ?? "disabled")
  const [version, setVersion] = React.useState(record?.version ?? 1)
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setName(record?.name ?? "")
      setUrl(record?.url ?? "")
      setSortOrder(record ? String(record.sortOrder) : "")
      setFieldErrors(undefined)
      setStatus(record?.status ?? "disabled")
      setVersion(record?.version ?? 1)
    }
  }, [open, record])

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) setFieldErrors(error.fields)
    toast.error(error.message)
  }

  async function submit() {
    if (!name.trim() || !url.trim()) return
    setSubmitting(true)
    setFieldErrors(undefined)
    const sort = sortOrder.trim()
    if (isEdit && record) {
      const res = await adminPatch<LineDto>(
        `/lines/${record.id}`,
        { name, url, ...(sort ? { sortOrder: Number(sort) } : {}), version },
        { csrfToken },
      )
      setSubmitting(false)
      if (!res.ok) {
        handleError(res.error)
        return
      }
      toast.success(`线路「${res.data.name}」已保存`)
      setStatus(res.data.status)
      setVersion(res.data.version)
      onSaved(res.data)
      onOpenChange(false)
    } else {
      const res = await adminPost<LineDto>(
        "/lines",
        { name, url, ...(sort ? { sortOrder: Number(sort) } : {}) },
        { csrfToken },
      )
      setSubmitting(false)
      if (!res.ok) {
        handleError(res.error)
        return
      }
      toast.success(`线路「${res.data.name}」已创建（默认停用）`)
      onSaved(res.data)
      onOpenChange(false)
    }
  }

  async function changeStatus(next: LineStatus, label: string) {
    if (!record) return
    setStatusBusy(label)
    const res = await adminPatch<LineDto>(`/lines/${record.id}/status`, { status: next, version }, { csrfToken })
    setStatusBusy(null)
    if (res.ok) {
      toast.success(`线路「${record.name}」已${label}`)
      setStatus(res.data.status)
      setVersion(res.data.version)
      onSaved(res.data)
    } else {
      toast.error(res.error.message)
    }
  }

  const canSubmit = Boolean(name.trim() && url.trim()) && !submitting

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isEdit ? `编辑线路：${record?.name ?? ""}` : "新建线路"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {isEdit ? (
                <>
                  <span>当前版本 v{version}；保存时服务端做乐观锁校验。</span>
                  <StatusPill status={status} />
                </>
              ) : (
                <span>新建线路默认为「停用」，需在弹窗或列表「启用」后才对外展示。</span>
              )}
            </Dialog.Description>

            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <FormField id="line-name" label="线路名称" required error={fieldErrors?.name}>
                <TextInput
                  id="line-name"
                  value={name}
                  maxLength={255}
                  showCount
                  placeholder="例如：线路一（主入口）"
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                />
              </FormField>
              <FormField
                id="line-url"
                label="线路 URL"
                required
                error={fieldErrors?.url}
                description="完整 http(s) 链接；保存时服务端不做可达性探测（探测属前台）"
              >
                <TextInput
                  id="line-url"
                  value={url}
                  maxLength={2048}
                  placeholder="https://example.com/entry"
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={submitting}
                />
              </FormField>
              <FormField id="line-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                <TextInput
                  id="line-sort"
                  inputMode="numeric"
                  value={sortOrder}
                  placeholder="0"
                  onChange={(e) => setSortOrder(e.target.value)}
                  disabled={submitting}
                />
              </FormField>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                {isEdit && canUpdate
                  ? [
                      { label: "启用", next: "active" as LineStatus },
                      { label: "停用", next: "disabled" as LineStatus },
                    ]
                      .filter((a) => a.next !== status)
                      .map((a) => (
                        <RowAction
                          key={a.next}
                          type="button"
                          loading={statusBusy === a.label}
                          disabled={Boolean(statusBusy) || submitting}
                          onClick={() => void changeStatus(a.next, a.label)}
                        >
                          {a.label}
                        </RowAction>
                      ))
                  : null}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting || Boolean(statusBusy)}
                  className="adm-btn adm-touch-target inline-flex h-9 items-center rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || Boolean(statusBusy)}
                  className="adm-btn adm-touch-target inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {submitting ? "保存中" : "保存"}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
