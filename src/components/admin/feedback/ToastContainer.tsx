"use client"

// P5：Toast 容器（视觉层；状态由 ToastProvider 管理）
// 固定于右下角；aria-live：error=assertive，其余=polite

import * as React from "react"
import { AlertTriangle, CircleCheck, CircleX, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToastItem, ToastType } from "./ToastProvider"

const ICONS: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CircleCheck,
  error: CircleX,
  warning: AlertTriangle,
  info: Info,
}

const TONES: Record<ToastType, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-info",
}

interface Props {
  items: ToastItem[]
  onDismiss: (id: number) => void
}

export function ToastContainer({ items, onDismiss }: Props) {
  return (
    <div
      className="adm-toast-region pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      aria-label="通知"
    >
      {items.map((item) => {
        const Icon = ICONS[item.type]
        return (
          <div
            key={item.id}
            role={item.type === "error" ? "alert" : "status"}
            aria-live={item.type === "error" ? "assertive" : "polite"}
            className="adm-toast pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg animate-toast-in"
          >
            <Icon className={cn("mt-0.5 size-4.5 shrink-0", TONES[item.type])} aria-hidden />
            <p className="adm-toast-msg min-w-0 flex-1 text-sm leading-5 break-words text-foreground">
              {item.message}
            </p>
            <button
              type="button"
              aria-label="关闭通知"
              onClick={() => onDismiss(item.id)}
              className="adm-toast-close -m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
