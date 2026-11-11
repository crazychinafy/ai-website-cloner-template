"use client"

// P5：状态徽章（通用；业务侧传入 tone 与文案）

import * as React from "react"
import { cn } from "@/lib/utils"

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info-soft text-info",
  neutral: "bg-muted text-muted-foreground",
}

const DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
}

interface Props {
  tone: StatusTone
  children: React.ReactNode
  /** 显示前置圆点（默认 true） */
  dot?: boolean
  className?: string
}

export function StatusBadge({ tone, children, dot = true, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden /> : null}
      {children}
    </span>
  )
}
