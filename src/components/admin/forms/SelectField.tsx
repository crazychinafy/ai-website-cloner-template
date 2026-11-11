"use client"

// P5：SelectField（FormField 家族；原生 select —— 键盘/读屏支持最稳）

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { FormFieldContext } from "./FormField"
import { cn } from "@/lib/utils"

export interface SelectOption {
  label: string
  value: string
  disabled?: boolean
}

interface Props
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className" | "disabled" | "id" | "aria-invalid" | "aria-describedby"> {
  id: string
  options: SelectOption[]
  /** 占位选项（value 为空串） */
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  description?: string
  ariaDescribedBy?: string
  className?: string
}

export function SelectField({
  id,
  options,
  placeholder,
  disabled = false,
  loading = false,
  error,
  description,
  ariaDescribedBy,
  value,
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

  return (
    <div className="relative">
      <select
        id={id}
        disabled={disabledAll || undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        value={value}
        className={cn(
          "adm-input h-9 w-full appearance-none rounded-md border bg-card px-3 pr-9 text-sm outline-none",
          "text-foreground transition-colors disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground",
          hasError ? "border-destructive focus:border-destructive" : "border-input focus:border-primary",
          "focus:ring-2",
          hasError ? "focus:ring-destructive/20" : "focus:ring-ring/20",
          className,
        )}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  )
}
