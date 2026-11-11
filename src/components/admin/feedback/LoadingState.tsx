"use client"

// P5：加载状态（Skeleton 变体；避免全站只有一个转圈）

import * as React from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden />
}

/** 表格加载骨架：保留表头占位 + N 行 */
export function TableLoadingSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn("h-4", i === 0 ? "w-1/4" : "flex-1")} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-t border-border pt-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 区块/卡片加载骨架 */
export function CardLoadingSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-lg border border-border bg-card p-5", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-4/5" : "w-3/5")} />
      ))}
    </div>
  )
}

/** 全屏/整页加载 */
export function PageLoading({ label = "加载中" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
