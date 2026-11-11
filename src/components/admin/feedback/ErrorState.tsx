"use client"

// P5：错误状态（接口异常 / 页面错误）
// - 展示通用文案 + requestId（服务端返回时）；
// - 绝不展示 SQL、堆栈或内部异常细节（服务端信封已保证只给通用 message）。

import * as React from "react"
import { AlertOctagon } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  title?: string
  description?: string
  /** 重试按钮（存在时才显示） */
  onRetry?: () => void
  retryLabel?: string
  /** API 返回的请求追踪 ID（展示，便于反馈问题） */
  requestId?: string
  className?: string
}

export function ErrorState({
  title = "加载失败",
  description = "服务暂时不可用，请稍后重试。",
  onRetry,
  retryLabel = "重试",
  requestId,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)} role="alert">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertOctagon className="size-7" aria-hidden />
      </div>
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="mt-1 flex items-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="adm-touch-target inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
      {requestId ? (
        <p className="text-xs text-muted-foreground">
          请求编号 <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{requestId}</code>
        </p>
      ) : null}
    </div>
  )
}
