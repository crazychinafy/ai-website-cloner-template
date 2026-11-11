"use client"

// P6A：文章分类 新建/编辑 表单弹窗（独立一级资源，无父级）
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { ArticleCategoryDto } from "@/lib/admin/dto/content"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { SelectField } from "../forms/SelectField"
import { IconClassPreview } from "./content-ui"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  csrfToken: string
  /** 编辑时传当前记录；新建传 null */
  record: ArticleCategoryDto | null
  onSaved: (record: ArticleCategoryDto) => void
}

interface FormState {
  name: string
  iconClass: string
  sortOrder: string
  status: "active" | "disabled"
}

const EMPTY: FormState = { name: "", iconClass: "", sortOrder: "", status: "active" }

export function ArticleCategoryFormDialog({ open, onOpenChange, csrfToken, record, onSaved }: Props) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setForm(
        record
          ? { name: record.name, iconClass: record.iconClass, sortOrder: String(record.sortOrder), status: record.status }
          : EMPTY,
      )
      setFieldErrors(null)
    }
  }, [open, record])

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setFieldErrors(null)

    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder)
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      setFieldErrors({ sortOrder: "排序值必须是非负整数" })
      setSubmitting(false)
      return
    }

    try {
      const body = {
        name: form.name.trim(),
        iconClass: form.iconClass.trim(),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        status: form.status,
      }
      const res = record
        ? await adminPatch<ArticleCategoryDto>(`/article-categories/${record.id}`, { ...body, version: record.version }, { csrfToken })
        : await adminPost<ArticleCategoryDto>("/article-categories", body, { csrfToken })
      if (!res.ok) {
        if (res.error.fields && Object.keys(res.error.fields).length > 0) setFieldErrors(res.error.fields)
        toast.error(res.error.message)
        return
      }
      toast.success(record ? `文章分类「${res.data.name}」已更新` : `文章分类「${res.data.name}」已创建`)
      onSaved(res.data)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {record ? `编辑文章分类：${record.name}` : "新建文章分类"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {record ? `当前版本 v${record.version}；保存时服务端会做乐观锁校验` : "文章分类为独立的一级资源，与网址分类互不影响"}
            </Dialog.Description>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <FormField id="ac-name" label="分类名称" required error={fieldErrors?.name}>
                <TextInput
                  id="ac-name"
                  value={form.name}
                  maxLength={120}
                  showCount
                  placeholder="例如：行业快讯"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <FormField
                id="ac-icon"
                label="图标 Class"
                error={fieldErrors?.iconClass}
                description="iconfont class（空格分隔），可留空"
                labelSuffix={<IconClassPreview iconClass={form.iconClass.trim()} />}
              >
                <TextInput
                  id="ac-icon"
                  value={form.iconClass}
                  maxLength={255}
                  placeholder="例如：iconfont icon-news"
                  onChange={(e) => setForm((f) => ({ ...f, iconClass: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField id="ac-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                  <TextInput
                    id="ac-sort"
                    inputMode="numeric"
                    value={form.sortOrder}
                    placeholder="0"
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    disabled={submitting}
                  />
                </FormField>
                <FormField id="ac-status" label="状态">
                  <SelectField
                    id="ac-status"
                    value={form.status}
                    options={[
                      { label: "启用", value: "active" },
                      { label: "停用", value: "disabled" },
                    ]}
                    disabled={submitting}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value === "disabled" ? "disabled" : "active" }))}
                  />
                </FormField>
              </div>

              <div className="mt-6 flex flex-row-reverse gap-3">
                <button
                  type="submit"
                  disabled={submitting || !form.name.trim()}
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
