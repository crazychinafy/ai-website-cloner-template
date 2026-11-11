"use client"

// P6B：网址 新建/编辑 表单弹窗（site_links 聚合：主字段 + 详情补充 1:1 + 备用链接 1:N）
// ─────────────────────────────────────────────────────────────────
// - 新建恒为草稿（status 由服务端固定）；编辑弹窗内嵌状态流转按钮（links.publish 权限），
//   走 PATCH /links/[id]/status 并同步本地 version，避免随后保存时版本冲突
// - 详情勾选框：未勾选=不提交 detail（编辑已有详情时提交 null = 删除详情行）
// - 备用链接为「全量替换」编辑器：数组顺序即 sortOrder；保留行携带原 ID
// - 字段错误来自服务端 Zod 信封（fields map，leaf 键）；409 直接展示服务端中文文案
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { LinkAggregateDto, LinkStatus } from "@/lib/admin/dto/link"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { TextareaField } from "../forms/TextareaField"
import { SelectField, type SelectOption } from "../forms/SelectField"
import { LinkStatusPill, RowAction } from "./content-ui"

export interface LinkFormValues {
  mode: "create" | "edit"
  /** 编辑时的聚合记录（GET /links/[id] 产物，含 detail/mirrors） */
  record?: LinkAggregateDto
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  csrfToken: string
  values: LinkFormValues | null
  categoryOptions: SelectOption[]
  tagOptions: SelectOption[]
  canPublish: boolean
  /** 保存/状态变更后通知父组件刷新列表 */
  onSaved: (record: LinkAggregateDto | { id: string }) => void
}

interface MirrorRow {
  key: number
  id?: string
  name: string
  url: string
}

interface FormState {
  title: string
  url: string
  description: string
  logoPath: string
  categoryId: string
  tagId: string
  sortOrder: string
  hasDetail: boolean
  annotation: string
  previewImage: string
  detailHtml: string
  clickCount: string
  likeCount: string
  mirrors: MirrorRow[]
}

const EMPTY_FORM: FormState = {
  title: "",
  url: "",
  description: "",
  logoPath: "",
  categoryId: "",
  tagId: "",
  sortOrder: "",
  hasDetail: false,
  annotation: "",
  previewImage: "",
  detailHtml: "",
  clickCount: "",
  likeCount: "",
  mirrors: [],
}

function initialForm(values: LinkFormValues): FormState {
  const r = values.record
  if (!r) return { ...EMPTY_FORM, mirrors: [] }
  return {
    title: r.title,
    url: r.url,
    description: r.description,
    logoPath: r.logoPath,
    categoryId: r.categoryId,
    tagId: r.tagId ?? "",
    sortOrder: String(r.sortOrder),
    hasDetail: r.detail !== null,
    annotation: r.detail?.annotation ?? "",
    previewImage: r.detail?.previewImage ?? "",
    detailHtml: r.detail?.detailHtml ?? "",
    clickCount: r.detail ? String(r.detail.clickCount) : "",
    likeCount: r.detail ? String(r.detail.likeCount) : "",
    mirrors: r.mirrors.map((m) => ({ key: Number(m.id), id: m.id, name: m.name, url: m.url })),
  }
}

/** 三态可达流转（与服务端状态机一致：disabled→draft 不可直接） */
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

function parseCount(raw: string, label: string): number | undefined | "invalid" {
  const t = raw.trim()
  if (t === "") return undefined
  const n = Number(t)
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return "invalid"
  void label
  return n
}

export function LinkFormDialog({ open, onOpenChange, csrfToken, values, categoryOptions, tagOptions, canPublish, onSaved }: Props) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [version, setVersion] = React.useState(1)
  const [status, setStatus] = React.useState<LinkStatus>("draft")
  const [hasExistedDetail, setHasExistedDetail] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [mirrorErrors, setMirrorErrors] = React.useState<Record<number, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null)
  const nextKey = React.useRef(1)

  React.useEffect(() => {
    if (open && values) {
      setForm(initialForm(values))
      setVersion(values.record?.version ?? 1)
      setStatus(values.record?.status ?? "draft")
      setHasExistedDetail(values.record?.detail != null)
      setFieldErrors(null)
      setMirrorErrors({})
    }
  }, [open, values])

  const isEdit = values?.mode === "edit"
  const record = values?.record

  // 编辑目标引用的分类/标签不在「未删除」选项里时（历史/孤儿数据），补一条当前值，避免误改
  const catSelectOptions = React.useMemo<SelectOption[]>(() => {
    if (record && !categoryOptions.some((o) => o.value === record.categoryId)) {
      return [...categoryOptions, { label: `${record.categoryName ?? "当前分类（已删除）"}`, value: record.categoryId }]
    }
    return categoryOptions
  }, [categoryOptions, record])
  const tagSelectOptions = React.useMemo<SelectOption[]>(() => {
    if (record?.tagId && !tagOptions.some((o) => o.value === record.tagId)) {
      return [...tagOptions, { label: `${record.tagName ?? "当前标签（已删除）"}`, value: record.tagId }]
    }
    return tagOptions
  }, [tagOptions, record])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // ── 备用链接编辑器 ──
  function addMirror() {
    setForm((f) => (f.mirrors.length >= 20 ? f : { ...f, mirrors: [...f.mirrors, { key: nextKey.current++, name: "", url: "" }] }))
  }
  function updateMirror(index: number, patch: Partial<Omit<MirrorRow, "key">>) {
    setForm((f) => ({ ...f, mirrors: f.mirrors.map((m, i) => (i === index ? { ...m, ...patch } : m)) }))
    setMirrorErrors((e) => {
      if (!(index in e)) return e
      const next: Record<number, string> = {}
      for (const k of Object.keys(e)) if (Number(k) !== index) next[Number(k)] = e[Number(k)]!
      return next
    })
  }
  function removeMirror(index: number) {
    setForm((f) => ({ ...f, mirrors: f.mirrors.filter((_, i) => i !== index) }))
    setMirrorErrors({})
  }
  function moveMirror(index: number, direction: -1 | 1) {
    setForm((f) => {
      const target = index + direction
      if (target < 0 || target >= f.mirrors.length) return f
      const mirrors = [...f.mirrors]
      const tmp = mirrors[index]!
      mirrors[index] = mirrors[target]!
      mirrors[target] = tmp
      return { ...f, mirrors }
    })
    setMirrorErrors({})
  }

  function validateMirrors(): { ok: boolean; errors: Record<number, string> } {
    const errors: Record<number, string> = {}
    form.mirrors.forEach((m, i) => {
      if (!m.name.trim()) errors[i] = "名称不能为空"
      else if (!m.url.trim()) errors[i] = "地址不能为空"
    })
    return { ok: Object.keys(errors).length === 0, errors }
  }

  // ── 状态流转（编辑态内嵌；PATCH /status 后同步本地 version）──
  async function changeStatus(next: LinkStatus, label: string) {
    if (!record || statusBusy) return
    setStatusBusy(label)
    const res = await adminPatch<{ version: number }>(`/links/${record.id}/status`, { status: next, version }, { csrfToken })
    setStatusBusy(null)
    if (res.ok) {
      setStatus(next)
      setVersion(res.data.version)
      toast.success(`「${record.title}」已${label}`)
      onSaved({ id: record.id })
    } else {
      toast.error(res.error.message)
      if (res.error.status === 409 || res.error.status === 404) onOpenChange(false)
    }
  }

  // ── 提交 ──
  function buildDetail() {
    const click = parseCount(form.clickCount, "点击数")
    const like = parseCount(form.likeCount, "点赞数")
    if (click === "invalid" || like === "invalid") return "invalid" as const
    const detail: Record<string, unknown> = {
      annotation: form.annotation.trim(),
      previewImage: form.previewImage.trim(),
      detailHtml: form.detailHtml,
    }
    if (click !== undefined) detail.clickCount = click
    if (like !== undefined) detail.likeCount = like
    return detail
  }

  async function submit() {
    if (!values || submitting) return
    const mirrorCheck = validateMirrors()
    if (!mirrorCheck.ok) {
      setMirrorErrors(mirrorCheck.errors)
      toast.error("备用链接填写不完整：每行都需要名称与地址")
      return
    }
    const detailPayload = form.hasDetail ? buildDetail() : undefined
    if (detailPayload === "invalid") {
      setFieldErrors({ clickCount: "点击数必须是非负整数", likeCount: "点赞数必须是非负整数" })
      toast.error("详情计数字段不合法")
      return
    }
    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder)
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      setFieldErrors({ sortOrder: "排序值必须是非负整数" })
      return
    }

    setSubmitting(true)
    setFieldErrors(null)
    const mirrors = form.mirrors.map((m) => ({ ...(m.id ? { id: m.id } : {}), name: m.name.trim(), url: m.url.trim() }))

    try {
      if (isEdit && record) {
        const res = await adminPatch<LinkAggregateDto>(
          `/links/${record.id}`,
          {
            title: form.title.trim(),
            url: form.url.trim(),
            description: form.description.trim(),
            logoPath: form.logoPath.trim(),
            categoryId: form.categoryId,
            tagId: form.tagId === "" ? null : form.tagId,
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            detail: detailPayload ?? (record.detail ? null : undefined),
            mirrors,
            version,
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`网址「${res.data.title}」已更新`)
        onSaved(res.data)
        onOpenChange(false)
      } else {
        const res = await adminPost<LinkAggregateDto>(
          "/links",
          {
            title: form.title.trim(),
            url: form.url.trim(),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(form.logoPath.trim() ? { logoPath: form.logoPath.trim() } : {}),
            categoryId: form.categoryId,
            ...(form.tagId ? { tagId: form.tagId } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            ...(detailPayload && typeof detailPayload === "object" ? { detail: detailPayload } : {}),
            ...(mirrors.length > 0 ? { mirrors } : {}),
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`网址「${res.data.title}」已创建（草稿）`)
        onSaved(res.data)
        onOpenChange(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) setFieldErrors(error.fields)
    toast.error(error.message)
  }

  const canSubmit = Boolean(form.title.trim() && form.url.trim() && form.categoryId) && !submitting

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isEdit ? `编辑网址：${record?.title ?? ""}` : "新建网址"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {isEdit ? (
                <>
                  <span>
                    当前版本 v{version}；保存时服务端做乐观锁校验。状态变更需「网址发布」权限。
                  </span>
                  <LinkStatusPill status={status} />
                  {record?.sourceSnapshot ? <span className="font-mono text-xs">快照数据</span> : null}
                  {record?.isGone ? <span className="text-xs text-warning">源站疑似失效</span> : null}
                  {canPublish
                    ? STATUS_ACTIONS[status].map((a) => (
                        <RowAction
                          key={a.next}
                          type="button"
                          loading={statusBusy === a.label}
                          disabled={Boolean(statusBusy)}
                          onClick={() => void changeStatus(a.next, a.label)}
                        >
                          {a.label}
                        </RowAction>
                      ))
                    : null}
                </>
              ) : (
                <span>新建网址保存为「草稿」，需通过列表页「发布」操作上架（需要发布权限）。</span>
              )}
            </Dialog.Description>

            <form
              className="mt-5 space-y-6"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              {/* ── 基本信息 ── */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField id="link-title" label="网址名称" required error={fieldErrors?.title}>
                    <TextInput
                      id="link-title"
                      value={form.title}
                      maxLength={255}
                      showCount
                      placeholder="例如：欧易 OKX"
                      onChange={(e) => setField("title", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField
                    id="link-category"
                    label="所属分类"
                    required
                    error={fieldErrors?.categoryId}
                    description="只列出未删除的网址分类"
                  >
                    <SelectField
                      id="link-category"
                      value={form.categoryId}
                      options={catSelectOptions}
                      placeholder="选择分类"
                      onChange={(e) => setField("categoryId", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                </div>

                <FormField
                  id="link-url"
                  label="跳转地址"
                  required
                  error={fieldErrors?.url}
                  description="完整 http(s) 链接；不接受 javascript:、data: 等伪协议"
                >
                  <TextInput
                    id="link-url"
                    value={form.url}
                    maxLength={2048}
                    placeholder="https://example.com"
                    onChange={(e) => setField("url", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>

                <FormField id="link-desc" label="简介" error={fieldErrors?.description}>
                  <TextareaField
                    id="link-desc"
                    value={form.description}
                    maxLength={2000}
                    rows={2}
                    placeholder="一句话介绍该网址（可留空）"
                    onChange={(e) => setField("description", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="link-tag"
                    label="标签"
                    error={fieldErrors?.tagId}
                    description="可留空；列表页展示为彩色标签"
                  >
                    <SelectField
                      id="link-tag"
                      value={form.tagId}
                      options={tagSelectOptions}
                      placeholder="无标签"
                      onChange={(e) => setField("tagId", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                  <FormField id="link-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                    <TextInput
                      id="link-sort"
                      inputMode="numeric"
                      value={form.sortOrder}
                      placeholder="0"
                      onChange={(e) => setField("sortOrder", e.target.value)}
                      disabled={submitting}
                    />
                  </FormField>
                </div>

                <FormField
                  id="link-logo"
                  label="Logo 路径"
                  error={fieldErrors?.logoPath}
                  description="站内路径（/ 开头）或 http(s) 图片链接；可留空"
                  labelSuffix={form.logoPath.trim() ? <MediaPreview src={form.logoPath.trim()} alt="Logo 预览" /> : null}
                >
                  <TextInput
                    id="link-logo"
                    value={form.logoPath}
                    maxLength={1024}
                    placeholder="/uploads/logo.webp 或 https://cdn.example/logo.png"
                    onChange={(e) => setField("logoPath", e.target.value)}
                    disabled={submitting}
                  />
                </FormField>
              </section>

              {/* ── 详情补充 ── */}
              <section className="space-y-4 rounded-lg border border-border p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={form.hasDetail}
                    onChange={(e) => setField("hasDetail", e.target.checked)}
                    disabled={submitting}
                    className="size-4 accent-primary"
                  />
                  详情补充（site_link_details）
                  {hasExistedDetail && !form.hasDetail ? (
                    <span className="text-xs font-normal text-destructive">取消勾选并保存 = 删除现有详情行</span>
                  ) : null}
                </label>
                {form.hasDetail ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField id="link-anno" label="标注" error={fieldErrors?.annotation}>
                        <TextInput
                          id="link-anno"
                          value={form.annotation}
                          maxLength={500}
                          showCount
                          placeholder="编辑短评 / 推荐语（可留空）"
                          onChange={(e) => setField("annotation", e.target.value)}
                          disabled={submitting}
                        />
                      </FormField>
                      <FormField
                        id="link-preview"
                        label="预览图路径"
                        error={fieldErrors?.previewImage}
                        description="站内路径（/ 开头）或 http(s) 链接"
                        labelSuffix={form.previewImage.trim() ? <MediaPreview src={form.previewImage.trim()} alt="预览图预览" /> : null}
                      >
                        <TextInput
                          id="link-preview"
                          value={form.previewImage}
                          maxLength={1024}
                          placeholder="/uploads/preview.webp"
                          onChange={(e) => setField("previewImage", e.target.value)}
                          disabled={submitting}
                        />
                      </FormField>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField id="link-click" label="点击数" error={fieldErrors?.clickCount} description="留空 = 保持原值">
                        <TextInput
                          id="link-click"
                          inputMode="numeric"
                          value={form.clickCount}
                          placeholder="0"
                          onChange={(e) => setField("clickCount", e.target.value)}
                          disabled={submitting}
                        />
                      </FormField>
                      <FormField id="link-like" label="点赞数" error={fieldErrors?.likeCount} description="留空 = 保持原值">
                        <TextInput
                          id="link-like"
                          inputMode="numeric"
                          value={form.likeCount}
                          placeholder="0"
                          onChange={(e) => setField("likeCount", e.target.value)}
                          disabled={submitting}
                        />
                      </FormField>
                    </div>
                    <FormField
                      id="link-html"
                      label="详情正文（HTML）"
                      error={fieldErrors?.detailHtml}
                      description="服务端按白名单净化：script/iframe/事件属性/javascript: 链接会被剥离"
                    >
                      <TextareaField
                        id="link-html"
                        value={form.detailHtml}
                        maxLength={20000}
                        rows={6}
                        placeholder="<p>详细介绍…</p>"
                        onChange={(e) => setField("detailHtml", e.target.value)}
                        disabled={submitting}
                      />
                    </FormField>
                  </div>
                ) : null}
              </section>

              {/* ── 备用链接 ── */}
              <section className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">备用链接（保存时全量替换，顺序即展示顺序）</h3>
                  <RowAction type="button" onClick={addMirror} disabled={submitting || form.mirrors.length >= 20}>
                    <Plus className="size-3.5" aria-hidden />
                    添加备用链接
                  </RowAction>
                </div>
                {form.mirrors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无备用链接。</p>
                ) : (
                  <ul className="space-y-2">
                    {form.mirrors.map((m, i) => (
                      <li key={m.key} className="flex flex-wrap items-center gap-2">
                        <TextInput
                          id={`link-mirror-name-${i}`}
                          aria-label={`备用链接 ${i + 1} 名称`}
                          className="w-40"
                          value={m.name}
                          maxLength={255}
                          placeholder="线路名称"
                          onChange={(e) => updateMirror(i, { name: e.target.value })}
                          disabled={submitting}
                        />
                        <TextInput
                          id={`link-mirror-url-${i}`}
                          aria-label={`备用链接 ${i + 1} 地址`}
                          className="min-w-0 flex-1"
                          value={m.url}
                          maxLength={2048}
                          placeholder="https://mirror.example"
                          onChange={(e) => updateMirror(i, { url: e.target.value })}
                          disabled={submitting}
                        />
                        <RowAction type="button" title="上移" onClick={() => moveMirror(i, -1)} disabled={submitting || i === 0}>
                          <ArrowUp className="size-3.5" aria-hidden />
                        </RowAction>
                        <RowAction
                          type="button"
                          title="下移"
                          onClick={() => moveMirror(i, 1)}
                          disabled={submitting || i === form.mirrors.length - 1}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </RowAction>
                        <RowAction type="button" tone="danger" title="删除该行" onClick={() => removeMirror(i)} disabled={submitting}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </RowAction>
                        {mirrorErrors[i] ? <span className="w-full text-xs text-destructive">{mirrorErrors[i]}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">最多 20 条；保存后未出现在列表中的旧备用链接将被删除。</p>
              </section>

              <div className="flex flex-row-reverse gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="adm-btn adm-touch-target inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {submitting ? "保存中" : "保存"}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="adm-btn adm-touch-target inline-flex h-9 items-center rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  取消
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** 图片路径预览；加载失败（例如站内路径在后台域不存在）时自动隐藏 */
function MediaPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [src])
  if (failed) return <span className="text-xs text-muted-foreground/70">预览不可用</span>
  return (
    // 后台表单即时预览：地址是任意外部/站内动态 URL，未配置 next/image remotePatterns → 用原生 <img>
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="inline-block h-6 max-w-24 rounded border border-border bg-muted/40 object-contain"
    />
  )
}
