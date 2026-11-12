"use client"

// P6C：公告 新建/编辑 子页（/admin/bulletins/new、/admin/bulletins/[id]）
// ─────────────────────────────────────────────────────────────────
// 分节：基本信息（标题/排序值）→ 正文（RichTextEditor）→ 发布信息。
// - 新建恒 draft（服务端定）；sortOrder 留空 = 追加到有效行末尾（服务端 max+1）
// - 编辑 PATCH 不带 status（状态走发布/归档按钮 + bulletins.publish）；
//   受保护字段不在表单——服务端 strictObject 会 422
// - 乐观锁：编辑态携带 version；状态按钮成功后同步本地 version（同 LinkFormDialog 模式）
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Trash2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { BulletinDto, BulletinStatus } from "@/lib/admin/dto/bulletin"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { RichTextEditor } from "../forms/RichTextEditor"
import { ArticleStatusPill, PrimaryAction, RowAction, SecondaryAction, formatTime } from "./content-ui"
import { useToast } from "../feedback/ToastProvider"
import { PageLoading } from "../feedback/LoadingState"
import { ErrorState } from "../feedback/ErrorState"

interface Props {
  mode: "create" | "edit"
  bulletinId?: string
  csrfToken: string
  canPublish: boolean
  canDelete: boolean
}

interface FormState {
  title: string
  sortOrder: string // 数字字符串；"" = 不指定（新建追加末尾 / 编辑不改）
  contentHtml: string
}

const EMPTY_FORM: FormState = { title: "", sortOrder: "", contentHtml: "" }

/** 状态机流转表（与服务端一致；编辑器页只有可达转移） */
const STATUS_ACTIONS: Record<BulletinStatus, { label: string; next: BulletinStatus }[]> = {
  draft: [
    { label: "发布", next: "published" },
    { label: "归档", next: "archived" },
  ],
  published: [{ label: "归档", next: "archived" }],
  archived: [{ label: "重新发布", next: "published" }],
}

function toForm(r: BulletinDto): FormState {
  // contentEditable 灌服务端净化出的 editorHtml（整改问题 01，见文章编辑器同点注释）
  return { title: r.title, sortOrder: String(r.sortOrder), contentHtml: r.editorHtml }
}

function isValidSortOrder(v: string): boolean {
  return v === "" || /^\d{1,9}$/.test(v)
}

export function BulletinEditor({ mode, bulletinId, csrfToken, canPublish, canDelete }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = React.useState(mode === "edit")
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<BulletinDto | null>(null)
  const [initial, setInitial] = React.useState<FormState>(EMPTY_FORM)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [version, setVersion] = React.useState(1)
  const [status, setStatus] = React.useState<BulletinStatus>("draft")
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    if (mode !== "edit" || !bulletinId) return
    let cancelled = false
    void (async () => {
      const res = await adminGet<BulletinDto>(`/bulletins/${bulletinId}`)
      if (cancelled) return
      if (res.ok) {
        setRecord(res.data)
        setInitial(toForm(res.data))
        setForm(toForm(res.data))
        setVersion(res.data.version)
        setStatus(res.data.status)
      } else {
        setLoadError(res.error.message)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [mode, bulletinId])

  const isEdit = mode === "edit"
  const deleted = Boolean(record?.deletedAt)
  const sortOrderInvalid = !isValidSortOrder(form.sortOrder)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) setFieldErrors(error.fields)
    toast.error(error.message)
  }

  function appliedRecord(r: BulletinDto) {
    setRecord(r)
    setInitial(toForm(r))
    // 保存成功后采纳服务端元信息，但保留编辑器当前内容（toForm 读 editorHtml——问题 01）
    setForm((f) => toForm({ ...r, editorHtml: f.contentHtml }))
    setVersion(r.version)
    setStatus(r.status)
  }

  async function submit() {
    if (submitting || (isEdit && deleted) || sortOrderInvalid) return
    setSubmitting(true)
    setFieldErrors(null)
    try {
      if (isEdit && record) {
        // 只提交编辑过的可选字段（title 必带；sortOrder/contentHtml 有变化才带）
        const body: Record<string, unknown> = { title: form.title.trim(), version }
        if (form.contentHtml !== initial.contentHtml) body.contentHtml = form.contentHtml
        if (form.sortOrder !== initial.sortOrder) body.sortOrder = Number(form.sortOrder)
        const res = await adminPatch<BulletinDto>(`/bulletins/${record.id}`, body, { csrfToken })
        if (!res.ok) {
          handleError(res.error)
          if (res.error.status === 409 || res.error.status === 404) toast.error("请刷新后重新编辑")
          return
        }
        appliedRecord(res.data)
        toast.success(`公告「${res.data.title}」已保存`)
      } else {
        const body: Record<string, unknown> = { title: form.title.trim() }
        if (form.contentHtml) body.contentHtml = form.contentHtml
        if (form.sortOrder !== "") body.sortOrder = Number(form.sortOrder)
        const res = await adminPost<BulletinDto>("/bulletins", body, { csrfToken })
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`公告「${res.data.title}」已创建（草稿）`)
        router.push(`/admin/bulletins/${res.data.id}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function changeStatus(next: BulletinStatus, label: string) {
    if (!record || statusBusy) return
    setStatusBusy(label)
    const res = await adminPatch<BulletinDto>(`/bulletins/${record.id}/status`, { status: next, version }, { csrfToken })
    setStatusBusy(null)
    if (res.ok) {
      setStatus(next)
      setVersion(res.data.version)
      // 同步记录（publishedAt 等只读元信息即时刷新，免刷新即见发布时间）
      setRecord((cur) => (cur ? { ...cur, ...res.data } : cur))
      if (res.data.contentHtml !== form.contentHtml) {
        // 发布闸门可能顺带收敛了未清洗正文——同步编辑器，避免下次保存回写旧值
        // （问题 01：编辑器状态始终用服务端净化出的 editorHtml）
        setForm((f) => ({ ...f, contentHtml: res.data!.editorHtml }))
        setInitial((i) => ({ ...i, contentHtml: res.data!.editorHtml }))
      }
      toast.success(`「${record.title}」已${label}`)
    } else {
      handleError(res.error)
    }
  }

  async function doDelete() {
    if (!record) return
    const res = await adminDelete<BulletinDto>(`/bulletins/${record.id}?version=${version}`, { csrfToken })
    if (res.ok) {
      toast.success(`公告「${record.title}」已删除`)
      router.push("/admin/bulletins")
    } else {
      handleError(res.error)
      setConfirmDelete(false)
    }
  }

  const canSubmit = Boolean(form.title.trim()) && !submitting && !deleted && !sortOrderInvalid

  if (loading) return <PageLoading label="载入公告…" />
  if (isEdit && !record) {
    return (
      <ErrorState
        title="无法载入公告"
        description={loadError ?? "公告不存在或已被删除。"}
        retryLabel="返回列表"
        onRetry={() => router.push("/admin/bulletins")}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RowAction onClick={() => router.push("/admin/bulletins")} aria-label="返回列表">
            <ArrowLeft className="size-3.5" aria-hidden />
            返回
          </RowAction>
          <h1 className="truncate text-xl font-semibold text-foreground">
            {isEdit ? "编辑公告" : "新建公告"}
            {isEdit && record ? (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">#{record.id}</span>
            ) : null}
          </h1>
          {isEdit ? <ArticleStatusPill status={status} /> : null}
          {deleted ? (
            <span className="text-xs text-destructive">已删除（编辑不可用，请到列表「含已删除」视图恢复）</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isEdit && record ? (
            <>
              {canPublish
                ? STATUS_ACTIONS[status].map((a) => (
                    <RowAction
                      key={a.next}
                      onClick={() => void changeStatus(a.next, a.label)}
                      loading={statusBusy === a.label}
                      disabled={Boolean(statusBusy) || submitting || deleted}
                    >
                      {a.label}
                    </RowAction>
                  ))
                : null}
              {canDelete && !deleted ? (
                <RowAction tone="danger" onClick={() => setConfirmDelete(true)} disabled={submitting}>
                  <Trash2 className="size-3.5" aria-hidden />
                  删除
                </RowAction>
              ) : null}
            </>
          ) : null}
          <SecondaryAction onClick={() => router.push("/admin/bulletins")} disabled={submitting}>
            取消
          </SecondaryAction>
          <PrimaryAction onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? "保存中" : isEdit ? "保存" : "保存为草稿"}
          </PrimaryAction>
        </div>
      </div>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {/* ── 基本信息 ── */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">基本信息</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bulletin-title" label="公告标题" required error={fieldErrors?.title}>
              <TextInput
                id="bulletin-title"
                value={form.title}
                maxLength={500}
                showCount
                placeholder="公告标题（前台公告列表与详情共用）"
                onChange={(e) => setField("title", e.target.value)}
                disabled={submitting || deleted}
              />
            </FormField>
            <FormField
              id="bulletin-sort"
              label="排序值"
              error={fieldErrors?.sortOrder ?? (sortOrderInvalid ? "排序值必须是不超过 9 位的非负整数" : null)}
              description="数字越小越靠前；新建留空 = 追加到当前列表末尾"
            >
              <TextInput
                id="bulletin-sort"
                value={form.sortOrder}
                inputMode="numeric"
                placeholder="留空 = 自动追加末尾"
                onChange={(e) => setField("sortOrder", e.target.value.replace(/[^\d]/g, ""))}
                disabled={submitting || deleted}
              />
            </FormField>
          </div>
        </section>

        {/* ── 正文 ── */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">正文</h2>
          <FormField
            id="bulletin-content"
            label="正文（富文本）"
            error={fieldErrors?.contentHtml}
            description="正文由服务端按白名单净化（script/iframe/事件属性/javascript: 一律剥离）"
          >
            <RichTextEditor
              id="bulletin-content"
              initialHtml={record ? record.editorHtml : ""}
              onChange={(html) => setField("contentHtml", html)}
              disabled={submitting || deleted}
              ariaLabel="公告正文编辑器"
            />
          </FormField>
        </section>

        {/* ── 发布信息（只读语义 + 状态说明）── */}
        <section className="space-y-2 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">发布信息</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">状态</dt>
              <dd>{isEdit ? <ArticleStatusPill status={status} /> : <span className="text-foreground">新建恒为草稿</span>}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">发布时间</dt>
              <dd className="font-mono text-xs text-foreground">{isEdit ? formatTime(record?.publishedAt) : "首次发布时写入"}</dd>
            </div>
            {isEdit ? (
              <div className="flex justify-between gap-4 sm:justify-start">
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="font-mono text-xs text-foreground">{formatTime(record?.createdAt)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">乐观锁版本</dt>
              <dd className="font-mono text-xs text-foreground">v{version}</dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            发布 / 归档需要「公告发布」权限；已归档的公告可直接重新发布（保留原发布时间）。正文为空时无法发布。
          </p>
        </section>
      </form>

      {/* 删除确认（轻量：就地弹层） */}
      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="删除公告"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">删除公告「{record?.title ?? ""}」</h3>
            <p className="mt-2 text-sm text-muted-foreground">软删除后可在列表「含已删除」视图恢复；前台立即下架。</p>
            <div className="mt-5 flex justify-end gap-2">
              <SecondaryAction onClick={() => setConfirmDelete(false)}>取消</SecondaryAction>
              <button
                type="button"
                onClick={() => void doDelete()}
                className="adm-btn adm-touch-target inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
