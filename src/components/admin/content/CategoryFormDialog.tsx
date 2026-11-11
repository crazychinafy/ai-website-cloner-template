"use client"

// P6A：网址分类 新建/编辑 表单弹窗（Base UI Dialog + P5 FormField 家族）
// ─────────────────────────────────────────────────────────────────
// - 提交走真实 API（POST /categories、PATCH /categories/[id]）；成功后交还给父组件刷新
// - 字段错误来自服务端 Zod 信封（fields map），与输入框 aria 关联
// - 409（版本冲突/移动受限/停用级联）→ Toast 展示服务端中文文案，弹窗保持打开
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { CategoryDto } from "@/lib/admin/dto/content"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { SelectField } from "../forms/SelectField"
import { IconClassPreview } from "./content-ui"

export interface CategoryParentOption {
  value: string
  label: string
}

export interface CategoryFormValues {
  mode: "create" | "edit"
  /** 编辑时的当前记录 */
  record?: CategoryDto
  /** 新建/编辑的上级（"" = 一级） */
  parentId: string
  /** 父级不可改时的原因（有子分类的节点不能降为二级） */
  parentLockedReason?: string
  /** 新建子分类时预选的父级（可改） */
  presetParentId?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  csrfToken: string
  values: CategoryFormValues | null
  parentOptions: CategoryParentOption[]
  onSaved: (record: CategoryDto) => void
}

interface FormState {
  name: string
  iconClass: string
  parentId: string
  sortOrder: string
  status: "active" | "disabled"
}

function initialForm(values: CategoryFormValues): FormState {
  const r = values.record
  return {
    name: r?.name ?? "",
    iconClass: r?.iconClass ?? "",
    parentId: r ? (r.parentId ?? "") : (values.presetParentId ?? values.parentId ?? ""),
    sortOrder: r ? String(r.sortOrder) : "",
    status: r?.status ?? "active",
  }
}

export function CategoryFormDialog({ open, onOpenChange, csrfToken, values, parentOptions, onSaved }: Props) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<FormState>({ name: "", iconClass: "", parentId: "", sortOrder: "", status: "active" })
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open && values) {
      setForm(initialForm(values))
      setFieldErrors(null)
    }
  }, [open, values])

  const isEdit = values?.mode === "edit"
  const parentSelectDisabled = isEdit && Boolean(values?.parentLockedReason)

  async function submit() {
    if (!values || submitting) return
    setSubmitting(true)
    setFieldErrors(null)

    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder)
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      setFieldErrors({ sortOrder: "排序值必须是非负整数" })
      setSubmitting(false)
      return
    }

    try {
      const parentValue = values.parentLockedReason && isEdit ? (values.record?.parentId ?? "") : form.parentId
      const parentId = parentValue === "" ? null : parentValue
      if (isEdit && values.record) {
        const res = await adminPatch<CategoryDto>(
          `/categories/${values.record.id}`,
          {
            name: form.name.trim(),
            iconClass: form.iconClass.trim(),
            parentId,
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            status: form.status,
            version: values.record.version,
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`分类「${res.data.name}」已更新`)
        onSaved(res.data)
      } else {
        const res = await adminPost<CategoryDto>(
          "/categories",
          {
            name: form.name.trim(),
            iconClass: form.iconClass.trim(),
            ...(parentId !== null ? { parentId } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            status: form.status,
          },
          { csrfToken },
        )
        if (!res.ok) {
          handleError(res.error)
          return
        }
        toast.success(`分类「${res.data.name}」已创建`)
        onSaved(res.data)
      }
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  function handleError(error: { message: string; fields?: AdminFieldErrors }) {
    if (error.fields && Object.keys(error.fields).length > 0) {
      setFieldErrors(error.fields)
    }
    toast.error(error.message)
  }

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {isEdit ? `编辑分类：${values?.record?.name ?? ""}` : "新建网址分类"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {isEdit
                ? `当前版本 v${values?.record?.version}；保存时服务端会做乐观锁校验`
                : "分类为两级结构；选择上级即创建二级分类"}
            </Dialog.Description>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <FormField id="cat-name" label="分类名称" required error={fieldErrors?.name}>
                <TextInput
                  id="cat-name"
                  value={form.name}
                  maxLength={120}
                  showCount
                  placeholder="例如：虚拟币交易"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <FormField
                id="cat-parent"
                label="上级分类"
                error={fieldErrors?.parentId}
                description={values?.parentLockedReason ?? "留空 = 一级分类；选择一级分类 = 其下二级分类"}
              >
                <SelectField
                  id="cat-parent"
                  value={form.parentId}
                  options={parentOptions}
                  placeholder="无（作为一级分类）"
                  disabled={submitting || parentSelectDisabled}
                  onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
                />
              </FormField>

              <FormField
                id="cat-icon"
                label="图标 Class"
                error={fieldErrors?.iconClass}
                description="iconfont class（空格分隔），与前台展示一致；可留空"
                labelSuffix={<IconClassPreview iconClass={form.iconClass.trim()} />}
              >
                <TextInput
                  id="cat-icon"
                  value={form.iconClass}
                  maxLength={255}
                  placeholder="例如：iconfont icon-USDT"
                  onChange={(e) => setForm((f) => ({ ...f, iconClass: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField id="cat-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                  <TextInput
                    id="cat-sort"
                    inputMode="numeric"
                    value={form.sortOrder}
                    placeholder="0"
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    disabled={submitting}
                  />
                </FormField>
                <FormField id="cat-status" label="状态">
                  <SelectField
                    id="cat-status"
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
