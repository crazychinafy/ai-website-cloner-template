"use client"

// P5：TextInput（FormField 家族）
// - 自动继承 FormField 的 aria 关联（aria-invalid / aria-describedby）
// - 支持 前缀图标 / 内嵌操作按钮（如密码可见切换）
// - 支持 maxLength + 字符计数

import * as React from "react"
import { FormFieldContext } from "./FormField"
import { cn } from "@/lib/utils"

interface Props
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "disabled" | "id" | "aria-invalid" | "aria-describedby"> {
  id: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  description?: string
  /** 覆盖 FormField 的上下文（独立使用场景） */
  ariaDescribedBy?: string
  /** 输入框右侧内嵌元素（如"显示/隐藏密码"按钮） */
  trailing?: React.ReactNode
  /** 显示字符计数（需配合 maxLength） */
  showCount?: boolean
  /** 前缀图标 */
  leadingIcon?: React.ReactNode
  className?: string
}

export function TextInput({
  id,
  disabled = false,
  loading = false,
  error,
  description,
  ariaDescribedBy,
  trailing,
  showCount = false,
  leadingIcon,
  maxLength,
  value,
  className,
  ...rest
}: Props) {
  const ctx = React.useContext(FormFieldContext)
  const fieldId = ctx && ctx.id === id ? ctx.id : id
  const disabledAll = disabled || loading || (ctx && ctx.id === id ? ctx.disabled || ctx.loading : false)

  const parts: string[] = []
  if (ctx && ctx.id === id) {
    if (ctx.description) parts.push(`${id}-desc`)
    if (ctx.error) parts.push(`${id}-err`)
  } else {
    if (description) parts.push(`${id}-desc`)
    if (error) parts.push(`${id}-err`)
    if (ariaDescribedBy) parts.push(ariaDescribedBy)
  }
  const describedBy = parts.length > 0 ? parts.join(" ") : undefined

  const hasError = Boolean((ctx && ctx.id === id ? ctx.error : null) || error)
  const count = typeof value === "string" ? value.length : Array.isArray(value) ? value.join("").length : 0

  const input = (
    <input
      id={fieldId}
      disabled={disabledAll || undefined}
      aria-invalid={hasError || undefined}
      aria-describedby={describedBy}
      maxLength={maxLength}
      value={value}
      className={cn(
        "adm-input h-9 w-full rounded-md border bg-card px-3 text-sm text-foreground transition-colors outline-none",
        "placeholder:text-muted-foreground/70",
        "disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground",
        leadingIcon && "pl-9",
        (trailing || (showCount && maxLength)) && "pr-14",
        hasError ? "border-destructive focus:border-destructive" : "border-input focus:border-primary",
        "focus:ring-2",
        hasError ? "focus:ring-destructive/20" : "focus:ring-ring/20",
        className,
      )}
      {...rest}
    />
  )

  return (
    <div className="relative">
      {leadingIcon ? (
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden>
          {leadingIcon}
        </span>
      ) : null}
      {trailing ? (
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>
      ) : null}
      {showCount && maxLength ? (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs tabular-nums",
            count >= maxLength ? "text-destructive" : "text-muted-foreground",
            trailing && "right-12",
          )}
          aria-hidden
        >
          {count}/{maxLength}
        </span>
      ) : null}
      {input}
    </div>
  )
}
