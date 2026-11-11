"use client"

// P5：DataTable 通用表格（核心交付物；P6A-P6D 复用）
// ─────────────────────────────────────────────────────────────────
// - 受控组件：state（分页/排序/筛选）由父组件持有，DataTable 只负责展示与上抛
//   onStateChange —— 父组件据此请求服务端（服务端分页/排序/筛选，§9.2/9.3）
// - 泛型 DataTable<T>，列定义 Column<T>，不出现 any（§9.5）
// - 状态覆盖：loading（表内骨架）/ error（ErrorState + requestId）/ empty（EmptyState）
// - 行：唯一 key、可选行点击（键盘可达）、可选行操作区、可选状态列（业务侧用 StatusBadge）
// - 小屏：表格整体局部横向滚动（minTableWidth），不造成整页溢出（§15）

import * as React from "react"
import { cn } from "@/lib/utils"
import type { Column, TableState } from "../types/table"
import type { AdminApiError } from "@/lib/admin/ui/api-client"
import { DataTableHeader } from "./DataTableHeader"
import { DataTablePagination } from "./DataTablePagination"
import { EmptyState } from "../feedback/EmptyState"
import { ErrorState } from "../feedback/ErrorState"

export interface DataTableProps<T> {
  columns: Column<T>[]
  /** 当前页数据 */
  data: T[]
  /** 总记录数（服务端返回） */
  total: number
  /** 行唯一 key */
  rowKey: (row: T) => string | number
  /** 受控表格状态 */
  state: TableState
  /** 状态变更（分页/排序）——父组件负责重新请求服务端 */
  onStateChange: (next: TableState) => void
  loading?: boolean
  /** 错误：API 错误对象（显示 requestId）或纯文案 */
  error?: AdminApiError | string | null
  /** 错误重试 */
  onRetry?: () => void
  onRowClick?: (row: T) => void
  renderRowActions?: (row: T) => React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** 表格最小宽度（小屏局部横向滚动；默认 560px） */
  minTableWidth?: number
  ariaLabel?: string
  className?: string
}

function TableSkeletonRows({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border/60">
          <td colSpan={columns} className="px-4 py-3">
            <div className="flex gap-4" aria-hidden>
              <div className="h-3.5 w-1/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-1/5 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-1/6 animate-pulse rounded bg-muted" />
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}

export function DataTable<T>({
  columns,
  data,
  total,
  rowKey,
  state,
  onStateChange,
  loading = false,
  error = null,
  onRetry,
  onRowClick,
  renderRowActions,
  emptyTitle = "暂无数据",
  emptyDescription,
  emptyAction,
  minTableWidth = 560,
  ariaLabel,
  className,
}: DataTableProps<T>) {
  const hasActions = Boolean(renderRowActions)
  const colCount = columns.length + (hasActions ? 1 : 0)
  const isEmpty = !loading && !error && data.length === 0

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="admin-scroll max-h-full overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: minTableWidth }} aria-label={ariaLabel}>
          <DataTableHeader
            columns={columns}
            sort={state.sort}
            onSortChange={(sort) => onStateChange({ ...state, sort })}
            hasActions={hasActions}
          />
          <tbody>
            {loading ? (
              <TableSkeletonRows columns={colCount} />
            ) : error ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <ErrorState
                    requestId={typeof error === "object" ? error.requestId : undefined}
                    description={typeof error === "object" ? error.message : error}
                    onRetry={onRetry}
                  />
                </td>
              </tr>
            ) : isEmpty ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <EmptyState compact title={emptyTitle} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = rowKey(row)
                const clickable = Boolean(onRowClick)
                return (
                  <tr
                    key={key}
                    onClick={clickable ? () => onRowClick?.(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              onRowClick?.(row)
                            }
                          }
                        : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? "button" : undefined}
                    aria-label={clickable ? "打开该行" : undefined}
                    className={cn(
                      "border-b border-border/70 last:border-b-0 transition-colors",
                      clickable && "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                    )}
                  >
                    {columns.map((col) => {
                      const rec = row as Record<string, unknown>
                      const fallback = col.key in rec ? String(rec[col.key] ?? "") : ""
                      return (
                        <td
                          key={col.key}
                          style={col.width ? { width: col.width } : undefined}
                          className={cn(
                            "px-4 py-3 align-middle text-foreground",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right tabular-nums",
                            col.className,
                          )}
                        >
                          {col.render ? col.render(row) : fallback}
                        </td>
                      )
                    })}
                    {hasActions ? (
                      <td className="px-4 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {renderRowActions?.(row)}
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {!isEmpty ? (
        <DataTablePagination
          pagination={state.pagination}
          total={total}
          disabled={loading}
          onStateChange={(pagination) => onStateChange({ ...state, pagination })}
        />
      ) : null}
    </div>
  )
}
