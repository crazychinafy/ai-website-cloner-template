"use client"

// P5：DataTable 表头（含服务端排序按钮）
// - 排序状态 = { field, order }；点击循环 asc → desc → 取消
// - 只负责展示与触发 onSortChange，不在浏览器端重排已分页数据（§9.3）

import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Column, SortState } from "../types/table"

interface Props<T> {
  columns: Column<T>[]
  sort: SortState | null
  onSortChange: (sort: SortState | null) => void
  /** 存在行操作列时为 true（追加"操作"表头） */
  hasActions?: boolean
}

export function DataTableHeader<T>({ columns, sort, onSortChange, hasActions = false }: Props<T>) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/40">
        {columns.map((col) => {
          const active = sort?.field === col.key
          const alignClass =
            col.align === "center"
              ? "text-center justify-center"
              : col.align === "right"
                ? "text-right justify-end"
                : "text-left"
          return (
            <th
              key={col.key}
              scope="col"
              aria-sort={active ? (sort.order === "asc" ? "ascending" : "descending") : undefined}
              style={col.width ? { width: col.width } : undefined}
              className={cn(
                "h-11 px-4 text-xs font-medium whitespace-nowrap text-muted-foreground select-none",
                col.align === "center" && "text-center",
                col.align === "right" && "text-right",
              )}
            >
              {col.sortable ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!active) onSortChange({ field: col.key, order: "asc" })
                    else if (sort.order === "asc") onSortChange({ field: col.key, order: "desc" })
                    else onSortChange(null)
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                    alignClass,
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {col.header}
                  {active ? (
                    sort.order === "asc" ? (
                      <ArrowUp className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3.5" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                  )}
                  <span className="sr-only">
                    {active ? (sort.order === "asc" ? "，当前升序，点击切换为降序" : "，当前降序，点击取消排序") : "，点击按此列排序"}
                  </span>
                </button>
              ) : (
                <span className="inline-block">{col.header}</span>
              )}
            </th>
          )
        })}
        {hasActions ? (
          <th scope="col" className="w-1 h-11 px-4 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
            操作
          </th>
        ) : null}
      </tr>
    </thead>
  )
}
