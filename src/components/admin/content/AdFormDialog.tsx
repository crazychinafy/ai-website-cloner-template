"use client"

// P6D：广告 新建/编辑 表单弹窗（§11.2 分区：A 基本信息 / B 图片 / C 投放设置）
// ─────────────────────────────────────────────────────────────────
// - 新建恒为草稿（status 由服务端固定）；编辑弹窗底部内嵌 启用/停用 状态流转按钮
//   （ads.update 权限），走 PATCH /ads/[id]/status 并同步本地 version，避免随后保存冲突
// - 图片只有「路径」概念（P6D 无上传系统）：手填站内路径 + 从当前列表已有图片中选择 +
//   站内缩略预览；「预览」按钮只打开站内图片，绝不自动访问外部跳转地址（§11.1）
// - 投放时间用 datetime-local（YYYY-MM-DDTHH:mm），与服务端 adDateTimeSchema 兼容；
//   编辑时清空 = 提交 null 清除排期；排序值留空 = 不提交该字段（保持原值/自动排末尾）
// - 字段错误来自服务端 Zod 信封（fields map，leaf 键）；409 展示服务端中文文案
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { AdDbStatus, AdDto } from "@/lib/admin/dto/ad"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { SelectField, type SelectOption } from "../forms/SelectField"
import { AdStatusPill, MediaPreview, resolveMediaSrc, RowAction } from "./content-ui"

export interface AdFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 新建 */
  record: AdDto | null
  csrfToken: string
  /** 编辑弹窗内嵌状态流转按钮所需（ads.update） */
  canUpdate: boolean
  /** 图片选择器候选（当前列表页已有广告的 imagePath 去重） */
  knownImagePaths: string[]
  /** 任意写操作成功后回传最新行（列表合并 + 关闭时刷新） */
  onSaved: (record: AdDto) => void
}

/** 与服务端状态机一致：draft→active；active→disabled；disabled→active；expired→active/disabled */
const STATUS_ACTIONS: Record<AdDbStatus, { label: string; next: "active" | "disabled" }[]> = {
  draft: [{ label: "启用", next: "active" }],
  active: [{ label: "停用", next: "disabled" }],
  disabled: [{ label: "启用", next: "active" }],
  expired: [
    { label: "启用", next: "active" },
    { label: "停用", next: "disabled" },
  ],
}

const POSITION_OPTIONS: SelectOption[] = [{ label: "首页（home）", value: "home" }]

/** DB 墙钟串 "YYYY-MM-DD HH:mm:ss.SSS" → datetime-local 输入值 */
function toLocalInput(v: string | null): string {
  return v ? `${v.slice(0, 10)}T${v.slice(11, 16)}` : ""
}

interface FormState {
  title: string
  position: string
  targetUrl: string
  imagePath: string
  sortOrder: string
  startsAt: string
  endsAt: string
}

function initialForm(record: AdDto | null): FormState {
  return {
    title: record?.title ?? "",
    position: record?.position ?? "home",
    targetUrl: record?.targetUrl ?? "",
    imagePath: record?.imagePath ?? "",
    sortOrder: record ? String(record.sortOrder) : "",
    startsAt: toLocalInput(record?.startsAt ?? null),
    endsAt: toLocalInput(record?.endsAt ?? null),
  }
}

export function AdFormDialog({
  open,
  onOpenChange,
  record,
  csrfToken,
  canUpdate,
  knownImagePaths,
  onSaved,
}: AdFormDialogProps) {
  const { toast } = useToast()
  const isEdit = Boolean(record)
  const [form, setForm] = React.useState<FormState>(() => initialForm(record))
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | undefined>(undefined)
  const [submitting, setSubmitting] = React.useState(false)
  const [status, setStatus] = React.useState<AdDbStatus>(record?.status ?? "draft")
  const [version, setVersion] = React.useState(record?.version ?? 1)
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null)

  // 打开（或切换目标行）时重置表单
  React.useEffect(() => {
    if (open) {
      setForm(initialForm(record))
      setFieldErrors(undefined)
      setStatus(record?.status ?? "draft")
      setVersion(record?.version ?? 1)
    }
  }, [open, record])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) setFieldErrors(error.fields)
    toast.error(error.message)
  }

  async function submit() {
    setSubmitting(true)
    setFieldErrors(undefined)
    const base = {
      title: form.title,
      position: form.position,
      targetUrl: form.targetUrl,
      imagePath: form.imagePath,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
    }
    const sort = form.sortOrder.trim()
    if (isEdit && record) {
      const res = await adminPatch<AdDto>(
        `/ads/${record.id}`,
        { ...base, ...(sort ? { sortOrder: Number(sort) } : {}), version },
        { csrfToken },
      )
      setSubmitting(false)
      if (!res.ok) {
        handleError(res.error)
        return
      }
      toast.success(`广告「${res.data.title}」已保存`)
      setStatus(res.data.status)
      setVersion(res.data.version)
      onSaved(res.data)
      onOpenChange(false)
    } else {
      const res = await adminPost<AdDto>("/ads", { ...base, ...(sort ? { sortOrder: Number(sort) } : {}) }, { csrfToken })
      setSubmitting(false)
      if (!res.ok) {
        handleError(res.error)
        return
      }
      toast.success(`广告「${res.data.title}」已创建（草稿）`)
      onSaved(res.data)
      onOpenChange(false)
    }
  }

  async function changeStatus(next: "active" | "disabled", label: string) {
    if (!record) return
    setStatusBusy(label)
    const res = await adminPatch<AdDto>(`/ads/${record.id}/status`, { status: next, version }, { csrfToken })
    setStatusBusy(null)
    if (res.ok) {
      toast.success(`广告「${record.title}」已${label}`)
      setStatus(res.data.status)
      setVersion(res.data.version)
      onSaved(res.data)
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) onSaved(record)
    }
  }

  /** 预览：只在新窗口打开站内图片（绝不访问外部跳转地址） */
  function previewImage() {
    const src = resolveMediaSrc(form.imagePath.trim())
    if (src) window.open(src, "_blank", "noopener,noreferrer")
  }

  const canSubmit = Boolean(form.title.trim() && form.targetUrl.trim() && form.imagePath.trim()) && !submitting
  const imagePickerOptions: SelectOption[] = knownImagePaths.map((p) => ({ label: p, value: p }))

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isEdit ? `编辑广告：${record?.title ?? ""}` : "新建广告"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {isEdit ? (
                <>
                  <span>当前版本 v{version}；保存时服务端做乐观锁校验。</span>
                  <AdStatusPill status={status} />
                </>
              ) : (
                <span>新建广告保存为「草稿」，需在列表或本弹窗「启用」后才对外投放。</span>
              )}
            </Dialog.Description>

            <form
              className="mt-5 space-y-6"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              {/* ── A 基本信息 ── */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
                <FormField id="ad-title" label="广告标题" required error={fieldErrors?.title}>
                  <TextInput
                    id="ad-title"
                    value={form.title}
                    maxLength={255}
                    showCount
                    placeholder="例如：首页顶部横幅广告"
                    onChange={(e) => setField("title", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="ad-position" label="广告位置" required error={fieldErrors?.position} description="当前仅开放首页广告位">
                    <SelectField
                      id="ad-position"
                      value={form.position}
                      options={POSITION_OPTIONS}
                      onChange={(e) => setField("position", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField id="ad-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                    <TextInput
                      id="ad-sort"
                      inputMode="numeric"
                      value={form.sortOrder}
                      placeholder="0"
                      onChange={(e) => setField("sortOrder", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                </div>
                <FormField
                  id="ad-target"
                  label="跳转 URL"
                  required
                  error={fieldErrors?.targetUrl}
                  description="完整 http(s) 链接；服务端不访问该地址（无 SSRF），由使用者自行确认"
                >
                  <TextInput
                    id="ad-target"
                    value={form.targetUrl}
                    maxLength={2048}
                    placeholder="https://example.com/landing"
                    onChange={(e) => setField("targetUrl", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
              </section>

              {/* ── B 图片 ── */}
              <section className="space-y-4 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">图片（站内静态路径，无上传）</h3>
                <FormField
                  id="ad-image"
                  label="图片路径"
                  required
                  error={fieldErrors?.imagePath}
                  description="站内路径（/ 开头），文件必须已存在于项目静态目录；禁外部链接与 SVG/HTML"
                >
                  <TextInput
                    id="ad-image"
                    value={form.imagePath}
                    maxLength={1024}
                    placeholder="/sites/facai8/images/xxx.gif"
                    onChange={(e) => setField("imagePath", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <label htmlFor="ad-image-picker" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      图片选择
                    </label>
                    <SelectField
                      id="ad-image-picker"
                      value=""
                      options={imagePickerOptions}
                      placeholder="从当前列表图片中选择"
                      onChange={(e) => e.target.value && setField("imagePath", e.target.value)}
                      disabled={submitting || knownImagePaths.length === 0}
                    />
                  </div>
                  <RowAction type="button" onClick={previewImage} disabled={!form.imagePath.trim() || submitting}>
                    预览图片
                  </RowAction>
                  <MediaPreview src={form.imagePath.trim()} alt="广告图片预览" />
                </div>
              </section>

              {/* ── C 投放设置 ── */}
              <section className="space-y-4 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">投放设置</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="ad-starts"
                    label="投放开始时间"
                    error={fieldErrors?.startsAt}
                    description="留空 = 立即生效（启用后）；须早于结束时间"
                  >
                    <TextInput
                      id="ad-starts"
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => setField("startsAt", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField
                    id="ad-ends"
                    label="投放结束时间"
                    error={fieldErrors?.endsAt}
                    description="留空 = 不限结束；到期后有效状态变为「已过期」"
                  >
                    <TextInput
                      id="ad-ends"
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) => setField("endsAt", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                </div>
                {isEdit ? (
                  <p className="text-xs text-muted-foreground">
                    当前状态：<AdStatusPill status={status} />；有效状态由服务端按排期实时计算，只读展示。
                  </p>
                ) : null}
              </section>

              {/* ── 底部操作 ── */}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {isEdit && canUpdate
                  ? STATUS_ACTIONS[status].map((a) => (
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
                  {submitting ? "保存中" : isEdit ? "保存" : "保存草稿"}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
