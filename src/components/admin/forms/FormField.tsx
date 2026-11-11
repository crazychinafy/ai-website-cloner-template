"use client"

// P5：FormField 表单字段外壳（label / 必填 / 说明 / 错误 / 禁用）
// ─────────────────────────────────────────────────────────────────
// 通过 FormFieldContext 向内部控件（TextInput/SelectField/TextareaField）
// 传递 aria 信息：控件自动设置 aria-invalid 与 aria-describedby，
// 错误提示与输入框正确关联（任务书 §12 无障碍要求）。
// 控件也可独立使用（直接传 id/error/description 属性，不经过 FormField）。

import * as React from "react"
import { cn } from "@/lib/utils"

export interface FormFieldContextValue {
  id: string
  required: boolean
  error: string | null
  description: string | null
  disabled: boolean
  loading: boolean
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

interface Props {
  id: string
  label: string
  required?: boolean
  /** 帮助说明（输入框下方，灰色） */
  description?: React.ReactNode
  /** 错误文案（输入框下方，红色；与控件 aria 关联） */
  error?: string | null
  disabled?: boolean
  loading?: boolean
  /** label 右侧附注（如字符计数占位） */
  labelSuffix?: React.ReactNode
  /** 横向双列布局时占满（grid 子项用） */
  className?: string
  children: React.ReactNode
}

export function FormField({
  id,
  label,
  required = false,
  description,
  error,
  disabled = false,
  loading = false,
  labelSuffix,
  className,
  children,
}: Props) {
  const value = React.useMemo(
    () => ({
      id,
      required,
      error: error ?? null,
      description: typeof description === "string" ? description : null,
      disabled,
      loading,
    }),
    [id, required, error, description, disabled, loading],
  )

  const descId = description ? `${id}-desc` : undefined
  const errId = error ? `${id}-err` : undefined

  return (
    <FormFieldContext.Provider value={value}>
      <div className={cn("min-w-0", className)}>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={id} className={cn("text-sm font-medium text-foreground", (disabled || loading) && "text-muted-foreground")}>
            {label}
            {required ? (
              <span className="ml-0.5 text-destructive" aria-hidden>
                *
              </span>
            ) : null}
            {required ? <span className="sr-only">（必填）</span> : null}
          </label>
          {labelSuffix}
        </div>
        {children}
        {description ? (
          <p id={descId} className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errId} className="mt-1.5 text-xs leading-5 text-destructive" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  )
}
