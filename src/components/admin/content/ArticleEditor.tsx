"use client"

// P6C：文章 新建/编辑 子页（/admin/articles/new、/admin/articles/[id]）
// ─────────────────────────────────────────────────────────────────
// 分节：基本信息（标题/分类/封面）→ 正文（RichTextEditor + 服务端净化预览）→ SEO → 发布信息。
// - 新建恒 draft（服务端定）；编辑 PATCH 不带 status（状态走发布/归档按钮 + articles.publish）
// - 受保护字段（status/authorName/viewCount/publishedAt）不在表单——服务端 strictObject 会 422
// - 乐观锁：编辑态携带 version；状态按钮成功后同步本地 version（避免随后保存冲突，同 LinkFormDialog）
// - 预览：POST /articles/preview（服务端净化）→ 弹窗展示入库形态；预览正文 noindex 由不落库保证
import * as React from "react"
import { useRouter } from "next/navigation"
import { Dialog } from "@base-ui/react/dialog"
import { ArrowLeft, Trash2 } from "lucide-react"
import { adminDelete, adminGet, adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { ArticleDto, ArticlePreviewDto, ArticleStatus, PageResult } from "@/lib/admin/dto/article"
import type { CategoryDto } from "@/lib/admin/dto/content"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { SelectField, type SelectOption } from "../forms/SelectField"
import { RichTextEditor } from "../forms/RichTextEditor"
import { ArticleStatusPill, PrimaryAction, RowAction, SecondaryAction, formatTime } from "./content-ui"
import { useToast } from "../feedback/ToastProvider"
import { PageLoading } from "../feedback/LoadingState"
import { ErrorState } from "../feedback/ErrorState"

interface Props {
  mode: "create" | "edit"
  articleId?: string
  csrfToken: string
  canPublish: boolean
  canDelete: boolean
}

interface FormState {
  title: string
  categoryId: string
  contentHtml: string
  coverImage: string
  seoTitle: string
  seoKeywords: string
  seoDescription: string
}

const EMPTY_FORM: FormState = {
  title: "",
  categoryId: "",
  contentHtml: "",
  coverImage: "",
  seoTitle: "",
  seoKeywords: "",
  seoDescription: "",
}

/** 状态机流转表（与服务端一致；编辑器页只有可达转移） */
const STATUS_ACTIONS: Record<ArticleStatus, { label: string; next: ArticleStatus }[]> = {
  draft: [
    { label: "发布", next: "published" },
    { label: "归档", next: "archived" },
  ],
  published: [{ label: "归档", next: "archived" }],
  archived: [{ label: "重新发布", next: "published" }],
}

function toForm(r: ArticleDto): FormState {
  return {
    title: r.title,
    categoryId: r.categoryId,
    contentHtml: r.contentHtml,
    coverImage: r.coverImage,
    seoTitle: r.seoTitle,
    seoKeywords: r.seoKeywords,
    seoDescription: r.seoDescription,
  }
}

/** 只提交「编辑过」的可选字段：与初始值不同才带上（undefined = 不改；空串 = 清空） */
function diffOptional(initial: FormState, next: FormState): Partial<FormState> {
  const out: Partial<FormState> = {}
  for (const key of ["contentHtml", "coverImage", "seoTitle", "seoKeywords", "seoDescription"] as const) {
    if (next[key] !== initial[key]) out[key] = next[key]
  }
  return out
}

export function ArticleEditor({ mode, articleId, csrfToken, canPublish, canDelete }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = React.useState(mode === "edit")
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<ArticleDto | null>(null)
  const [initial, setInitial] = React.useState<FormState>(EMPTY_FORM)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [version, setVersion] = React.useState(1)
  const [status, setStatus] = React.useState<ArticleStatus>("draft")
  const [categoryOptions, setCategoryOptions] = React.useState<SelectOption[]>([])
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  // 分类选项 +（编辑态）文章记录
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [cats, art] = await Promise.all([
        adminGet<PageResult<CategoryDto>>("/article-categories?pageSize=100&sortBy=sortOrder&sortDir=asc"),
        mode === "edit" && articleId ? adminGet<ArticleDto>(`/articles/${articleId}`) : Promise.resolve(null),
      ])
      if (cancelled) return
      if (cats.ok) {
        setCategoryOptions(
          cats.data.items.map((c) => ({ label: c.status === "disabled" ? `${c.name}（停用）` : c.name, value: c.id })),
        )
      }
      if (art) {
        if (!art.ok) {
          setLoadError(art.error.message)
        } else {
          setRecord(art.data)
          setInitial(toForm(art.data))
          setForm(toForm(art.data))
          setVersion(art.data.version)
          setStatus(art.data.status)
          // 编辑目标分类已删除（孤儿数据）时补当前值选项，避免误改
          if (!cats.ok || !cats.data.items.some((c) => c.id === art.data.categoryId)) {
            setCategoryOptions((opts) => [
              ...opts,
              { label: `${art.data.categoryName || "当前分类"}（已删除）`, value: art.data.categoryId },
            ])
          }
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [mode, articleId])

  const isEdit = mode === "edit"
  const deleted = Boolean(record?.deletedAt)

  // 编辑目标引用的分类不在选项里时补一条（服务端创建时同样允许停用分类）

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) setFieldErrors(error.fields)
    toast.error(error.message)
  }

  function appliedRecord(r: ArticleDto) {
    setRecord(r)
    setInitial(toForm(r))
    setForm((f) => toForm({ ...r, contentHtml: f.contentHtml }))
    setVersion(r.version)
    setStatus(r.status)
  }

  async function submit() {
    if (submitting || (isEdit && deleted)) return
    setSubmitting(true)
    setFieldErrors(null)
    try {
      const optional = diffOptional(initial, form)
      if (isEdit && record) {
        const res = await adminPatch<ArticleDto>(
          `/articles/${record.id}`,
          {
            title: form.title.trim(),
            categoryId: form.categoryId,
            ...optional,
            version,
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          if (res.error.status === 409 || res.error.status === 404) toast.error("请刷新后重新编辑")
          return
        }
        appliedRecord(res.data)
        toast.success(`文章「${res.data.title}」已保存`)
      } else {
        const res = await adminPost<ArticleDto>(
          "/articles",
          {
            title: form.title.trim(),
            categoryId: form.categoryId,
            ...optional,
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`文章「${res.data.title}」已创建（草稿）`)
        router.push(`/admin/articles/${res.data.id}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function changeStatus(next: ArticleStatus, label: string) {
    if (!record || statusBusy) return
    setStatusBusy(label)
    const res = await adminPatch<ArticleDto>(`/articles/${record.id}/status`, { status: next, version }, { csrfToken })
    setStatusBusy(null)
    if (res.ok) {
      setStatus(next)
      setVersion(res.data.version)
      // 同步记录（publishedAt 等只读元信息即时刷新，免刷新即见发布时间）
      setRecord((cur) => (cur ? { ...cur, ...res.data } : cur))
      if (res.data.contentHtml !== form.contentHtml) {
        // 发布闸门可能顺带收敛了未清洗正文——同步编辑器，避免下次保存回写旧值
        setForm((f) => ({ ...f, contentHtml: res.data!.contentHtml }))
        setInitial((i) => ({ ...i, contentHtml: res.data!.contentHtml }))
      }
      toast.success(`「${record.title}」已${label}`)
    } else {
      handleError(res.error)
    }
  }

  async function requestPreview(html: string) {
    if (previewBusy) return
    setPreviewBusy(true)
    const res = await adminPost<ArticlePreviewDto>("/articles/preview", { contentHtml: html }, { csrfToken })
    setPreviewBusy(false)
    if (!res.ok) {
      handleError(res.error)
      return
    }
    setPreviewHtml(res.data.html)
  }

  async function doDelete() {
    if (!record) return
    const res = await adminDelete<ArticleDto>(`/articles/${record.id}?version=${version}`, { csrfToken })
    if (res.ok) {
      toast.success(`文章「${record.title}」已删除`)
      router.push("/admin/articles")
    } else {
      handleError(res.error)
      setConfirmDelete(false)
    }
  }

  const canSubmit = Boolean(form.title.trim() && form.categoryId) && !submitting && !deleted

  if (loading) return <PageLoading label="载入文章…" />
  if (isEdit && !record) {
    return (
      <ErrorState
        title="无法载入文章"
        description={loadError ?? "文章不存在或已被删除。"}
        retryLabel="返回列表"
        onRetry={() => router.push("/admin/articles")}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RowAction onClick={() => router.push("/admin/articles")} aria-label="返回列表">
            <ArrowLeft className="size-3.5" aria-hidden />
            返回
          </RowAction>
          <h1 className="truncate text-xl font-semibold text-foreground">
            {isEdit ? `编辑文章` : "新建文章"}
            {isEdit && record ? <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">#{record.id}</span> : null}
          </h1>
          {isEdit ? <ArticleStatusPill status={status} /> : null}
          {deleted ? <span className="text-xs text-destructive">已删除（编辑不可用，请到列表「含已删除」视图恢复）</span> : null}
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
          <SecondaryAction onClick={() => router.push("/admin/articles")} disabled={submitting}>
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
            <FormField id="article-title" label="文章标题" required error={fieldErrors?.title}>
              <TextInput
                id="article-title"
                value={form.title}
                maxLength={500}
                showCount
                placeholder="文章标题（前台列表与详情共用）"
                onChange={(e) => setField("title", e.target.value)}
                disabled={submitting || deleted}
              />
            </FormField>
            <FormField
              id="article-category"
              label="所属分类"
              required
              error={fieldErrors?.categoryId}
              description="只列出未删除的文章分类；停用分类可保存草稿，但不能发布"
            >
              <SelectField
                id="article-category"
                value={form.categoryId}
                options={categoryOptions}
                placeholder="选择分类"
                onChange={(e) => setField("categoryId", e.target.value)}
                disabled={submitting || deleted}
              />
            </FormField>
          </div>
          <FormField
            id="article-cover"
            label="封面图路径"
            error={fieldErrors?.coverImage}
            description="站内素材路径（/uploads/ 等）或 http(s) 图片链接；可留空"
          >
            <TextInput
              id="article-cover"
              value={form.coverImage}
              maxLength={1024}
              placeholder="/uploads/xxx.webp"
              onChange={(e) => setField("coverImage", e.target.value)}
              disabled={submitting || deleted}
            />
          </FormField>
        </section>

        {/* ── 正文 ── */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">正文</h2>
          <FormField
            id="article-content"
            label="正文（富文本）"
            error={fieldErrors?.contentHtml}
            description="正文由服务端按白名单净化（script/iframe/事件属性/javascript: 一律剥离）；「HTML 预览」可查看入库形态"
          >
            <RichTextEditor
              id="article-content"
              initialHtml={record ? record.contentHtml : ""}
              onChange={(html) => setField("contentHtml", html)}
              disabled={submitting || deleted}
              onRequestPreview={(html) => requestPreview(html)}
              previewBusy={previewBusy}
              ariaLabel="文章正文编辑器"
            />
          </FormField>
        </section>

        {/* ── SEO ── */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">SEO</h2>
          <FormField id="article-seo-title" label="SEO 标题" error={fieldErrors?.seoTitle} description="留空 = 前台回退文章标题">
            <TextInput
              id="article-seo-title"
              value={form.seoTitle}
              maxLength={500}
              showCount
              onChange={(e) => setField("seoTitle", e.target.value)}
              disabled={submitting || deleted}
            />
          </FormField>
          <FormField id="article-seo-keywords" label="SEO 关键词" error={fieldErrors?.seoKeywords}>
            <TextInput
              id="article-seo-keywords"
              value={form.seoKeywords}
              maxLength={1000}
              placeholder="逗号分隔"
              onChange={(e) => setField("seoKeywords", e.target.value)}
              disabled={submitting || deleted}
            />
          </FormField>
          <FormField id="article-seo-desc" label="SEO 描述" error={fieldErrors?.seoDescription}>
            <TextInput
              id="article-seo-desc"
              value={form.seoDescription}
              maxLength={1000}
              showCount
              onChange={(e) => setField("seoDescription", e.target.value)}
              disabled={submitting || deleted}
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
              <dt className="text-muted-foreground">作者</dt>
              <dd className="text-foreground">{record?.authorName ?? "保存时记为当前管理员"}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:justify-start">
              <dt className="text-muted-foreground">浏览量</dt>
              <dd className="tabular-nums text-foreground">{record?.viewCount ?? "0"}（前台计数，后台只读）</dd>
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
            发布 / 归档需要「文章发布」权限；已归档的文章可直接重新发布（保留原发布时间）。正文为空时无法发布。
          </p>
        </section>
      </form>

      {/* 删除确认（轻量：就地弹层） */}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-label="删除文章">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">删除文章「{record?.title ?? ""}」</h3>
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

      {/* 服务端净化预览（HTML 预览 = 入库形态） */}
      <Dialog.Root open={previewHtml !== null} modal onOpenChange={(open) => !open && setPreviewHtml(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
            <Dialog.Popup className="adm-dialog my-auto flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
              <Dialog.Title className="text-base font-semibold text-foreground">净化预览（服务端产物）</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                这是正文经服务端白名单净化后将写入数据库的 HTML；保存后前台按此渲染。
              </Dialog.Description>
              <div
                className="adm-prose mt-4 min-h-24 flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 px-4 py-3 text-sm leading-7"
                // 预览内容 = 服务端 sanitizeRichHtml 产物（allowlist 内 HTML），此处渲染自身服务的净化结果是安全的
                dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
              />
              <div className="mt-4 flex justify-end">
                <SecondaryAction onClick={() => setPreviewHtml(null)}>关闭</SecondaryAction>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
