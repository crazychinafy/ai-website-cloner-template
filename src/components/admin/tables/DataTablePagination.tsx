"use client"

// P5：DataTable 分页器（服务端分页展示）
// - 显示：总记录数 / 当前页 / 总页数 / 上一页 / 下一页 / 每页条数（20/50/100）
// - UI 层限制 pageSize ∈ {20,50,100}（clampPageSize）；服务端仍独立校验
// - 页码变更通过 onStateChange 上抛，由父组件重新请求服务端

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { clampPage, clampPageSize, PAGE_SIZE_OPTIONS, totalPages } from "../types/table"
import type { PaginationState } from "../types/table"

interface Props {
  pagination: PaginationState
  total: number
  onStateChange: (next: PaginationState) => void
  disabled?: boolean
}

export function DataTablePagination({ pagination, total, onStateChange, disabled = false }: Props) {
  const pages = Math.max(totalPages(total, pagination.pageSize), 1)
  const page = clampPage(pagination.page, total, pagination.pageSize)
  const atStart = page <= 1
  const atEnd = page >= pages && total > 0

  function go(nextPage: number) {
    if (disabled) return
    const clamped = clampPage(nextPage, total, pagination.pageSize)
    if (clamped === page) return
    onStateChange({ ...pagination, page: clamped })
  }

  const navBtn =
    "adm-icon-btn inline-flex size-8 items-center justify-center rounded-md border border-input bg-card text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45"

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border px-4 py-3">
      <p className="text-sm whitespace-nowrap text-muted-foreground">
        共 <span className="font-medium text-foreground tabular-nums">{total.toLocaleString("zh-CN")}</span> 条
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">每页</span>
          <select
            aria-label="每页条数"
            value={pagination.pageSize}
            disabled={disabled}
            onChange={(e) => {
              const size = clampPageSize(Number(e.target.value))
              onStateChange({ page: 1, pageSize: size })
            }}
            className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} 条
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={navBtn}
            onClick={() => go(page - 1)}
            disabled={disabled || atStart}
            aria-label="上一页"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
            第 <span className="font-medium text-foreground">{page}</span> / {pages} 页
          </span>
          <button
            type="button"
            className={navBtn}
            onClick={() => go(page + 1)}
            disabled={disabled || atEnd}
            aria-label="下一页"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
