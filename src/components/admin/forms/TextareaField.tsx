"use client"

// P5：TextareaField（FormField 家族；支持字符计数）

import * as React from "react"
import { FormFieldContext } from "./FormField"
import { cn } from "@/lib/utils"

interface Props
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "disabled" | "id" | "aria-invalid" | "aria-describedby"> {
  id: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  description?: string
  ariaDescribedBy?: string
  /** 显示字符计数（默认 true；需 maxLength） */
  showCount?: boolean | null
  rows?: number
  className?: string
}

export function TextareaField({
  id,
  disabled = false,
  loading = false,
  error,
  description,
  ariaDescribedBy,
  showCount = true,
  rows = 4,
  value,
  maxLength,
  className,
  ...rest
}: Props) {
  const ctx = React.useContext(FormFieldContext)
  const fieldCtx = ctx && ctx.id === id ? ctx : null
  const disabledAll = disabled || loading || (fieldCtx ? fieldCtx.disabled || fieldCtx.loading : false)

  const parts: string[] = []
  if (fieldCtx) {
    if (fieldCtx.description) parts.push(`${id}-desc`)
    if (fieldCtx.error) parts.push(`${id}-err`)
  } else {
    if (description) parts.push(`${id}-desc`)
    if (error) parts.push(`${id}-err`)
    if (ariaDescribedBy) parts.push(ariaDescribedBy)
  }
  const describedBy = parts.length > 0 ? parts.join(" ") : undefined
  const hasError = Boolean((fieldCtx ? fieldCtx.error : null) || error)

  const count = typeof value === "string" ? value.length : Array.isArray(value) ? value.join("").length : 0
  const over = maxLength != null && count > maxLength

  return (
    <div>
      <textarea
        id={id}
        rows={rows}
        disabled={disabledAll || undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        value={value}
        maxLength={maxLength}
        className={cn(
          "adm-input w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-6 text-foreground transition-colors outline-none",
          "placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground",
          hasError ? "border-destructive focus:border-destructive" : "border-input focus:border-primary",
          "focus:ring-2",
          hasError ? "focus:ring-destructive/20" : "focus:ring-ring/20",
          className,
        )}
        {...rest}
      />
      {showCount && maxLength ? (
        <p
          className={cn("mt-1 text-right text-xs tabular-nums", over ? "text-destructive" : "text-muted-foreground")}
          aria-live="off"
        >
          {count}/{maxLength}
        </p>
      ) : null}
    </div>
  )
}
