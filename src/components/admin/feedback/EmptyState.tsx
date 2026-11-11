"use client"

// P5：空数据状态

import * as React from "react"
import { Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  title?: string
  description?: string
  icon?: React.ReactNode
  /** 可选操作（如"新建"按钮） */
  action?: React.ReactNode
  className?: string
  /** 紧凑模式（表格内部使用） */
  compact?: boolean
}

export function EmptyState({
  title = "暂无数据",
  description,
  icon,
  action,
  className,
  compact = false,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-6 py-14" : "gap-3 px-6 py-20",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          compact ? "size-12" : "size-16",
        )}
      >
        {icon ?? <Inbox className={compact ? "size-6" : "size-8"} aria-hidden />}
      </div>
      <p className={cn("font-medium text-foreground", compact ? "text-sm" : "text-base")}>{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
