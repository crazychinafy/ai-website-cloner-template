"use client"

// P6A：标签 新建/编辑 表单弹窗（名称 + iconfont class + 前景/背景色 + 实时样式预览）
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { adminPatch, adminPost, type AdminFieldErrors } from "@/lib/admin/ui/api-client"
import type { TagDto } from "@/lib/admin/dto/content"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { SelectField } from "../forms/SelectField"
import { IconClassPreview, TagChipPreview } from "./content-ui"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  csrfToken: string
  record: TagDto | null
  onSaved: (record: TagDto) => void
}

interface FormState {
  name: string
  iconClass: string
  color: string
  bgColor: string
  sortOrder: string
  status: "active" | "disabled"
}

const EMPTY: FormState = { name: "", iconClass: "", color: "#000000", bgColor: "#ffffff", sortOrder: "", status: "active" }
const HEX = /^#[0-9a-fA-F]{6}$/

export function TagFormDialog({ open, onOpenChange, csrfToken, record, onSaved }: Props) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [fieldErrors, setFieldErrors] = React.useState<AdminFieldErrors | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setForm(
        record
          ? {
              name: record.name,
              iconClass: record.iconClass,
              color: record.color,
              bgColor: record.bgColor,
              sortOrder: String(record.sortOrder),
              status: record.status,
            }
          : EMPTY,
      )
      setFieldErrors(null)
    }
  }, [open, record])

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setFieldErrors(null)

    const errors: AdminFieldErrors = {}
    if (!HEX.test(form.color)) errors.color = "颜色必须是 #RRGGBB 格式的 HEX 值"
    if (!HEX.test(form.bgColor)) errors.bgColor = "颜色必须是 #RRGGBB 格式的 HEX 值"
    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder)
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) errors.sortOrder = "排序值必须是非负整数"
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitting(false)
      return
    }

    try {
      const body = {
        name: form.name.trim(),
        iconClass: form.iconClass.trim(),
        color: form.color.toLowerCase(),
        bgColor: form.bgColor.toLowerCase(),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        status: form.status,
      }
      const res = record
        ? await adminPatch<TagDto>(`/tags/${record.id}`, { ...body, version: record.version }, { csrfToken })
        : await adminPost<TagDto>("/tags", body, { csrfToken })
      if (!res.ok) {
        if (res.error.fields && Object.keys(res.error.fields).length > 0) setFieldErrors(res.error.fields)
        toast.error(res.error.message)
        return
      }
      toast.success(record ? `标签「${res.data.name}」已更新` : `标签「${res.data.name}」已创建`)
      onSaved(res.data)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const colorInput = (key: "color" | "bgColor", id: string) => (
    <div className="flex items-center gap-2">
      {/* 原生取色器 + HEX 文本框双向同步 */}
      <input
        type="color"
        aria-label={key === "color" ? "文字颜色取色器" : "背景颜色取色器"}
        value={HEX.test(form[key]) ? form[key] : "#000000"}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        disabled={submitting}
        className="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1 disabled:cursor-not-allowed"
      />
      <TextInput
        id={id}
        value={form[key]}
        maxLength={7}
        placeholder="#RRGGBB"
        className="flex-1 font-mono"
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        disabled={submitting}
      />
    </div>
  )

  return (
    <Dialog.Root open={open} modal onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <Dialog.Popup className="adm-dialog my-auto w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in focus:outline-none">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {record ? `编辑标签：${record.name}` : "新建标签"}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {record ? `当前版本 v${record.version}；保存时服务端会做乐观锁校验` : "标签用于网址的彩色标记，颜色保存为 #RRGGBB"}
            </Dialog.Description>

            {/* 实时样式预览（与前台标签形态一致） */}
            <div className="mt-4 flex items-center gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">样式预览</span>
              <TagChipPreview name={form.name.trim()} iconClass={form.iconClass.trim()} color={HEX.test(form.color) ? form.color : "#000000"} bgColor={HEX.test(form.bgColor) ? form.bgColor : "#ffffff"} />
            </div>

            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <FormField id="tag-name" label="标签名称" required error={fieldErrors?.name}>
                <TextInput
                  id="tag-name"
                  value={form.name}
                  maxLength={100}
                  showCount
                  placeholder="例如：USDT"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <FormField
                id="tag-icon"
                label="图标 Class"
                error={fieldErrors?.iconClass}
                description="iconfont class（空格分隔），可留空"
                labelSuffix={<IconClassPreview iconClass={form.iconClass.trim()} />}
              >
                <TextInput
                  id="tag-icon"
                  value={form.iconClass}
                  maxLength={255}
                  placeholder="例如：iconfont icon-USDT"
                  onChange={(e) => setForm((f) => ({ ...f, iconClass: e.target.value }))}
                  disabled={submitting}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField id="tag-color" label="文字颜色" error={fieldErrors?.color}>
                  {colorInput("color", "tag-color")}
                </FormField>
                <FormField id="tag-bg" label="背景颜色" error={fieldErrors?.bgColor}>
                  {colorInput("bgColor", "tag-bg")}
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField id="tag-sort" label="排序值" error={fieldErrors?.sortOrder} description="留空 = 自动排到末尾">
                  <TextInput
                    id="tag-sort"
                    inputMode="numeric"
                    value={form.sortOrder}
                    placeholder="0"
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    disabled={submitting}
                  />
                </FormField>
                <FormField id="tag-status" label="状态">
                  <SelectField
                    id="tag-status"
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
