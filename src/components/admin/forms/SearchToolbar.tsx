"use client"

// P5：SearchToolbar 列表搜索工具栏（统一封装）
// ─────────────────────────────────────────────────────────────────
// - 受控：value/onChange 由父组件持有；搜索后触发 onSearch（父组件负责请求服务端并重置页码）
// - 不绑定具体业务、不在组件内部直接调用 API（任务书 §10）
// - 关键词输入框支持回车搜索；下拉筛选支持多个组合条件
// - 重置 = 清空全部筛选条件（并触发 onSearch，由父组件重置到第一页）
// - 响应式：字段自动换行，小屏纵向堆叠

import * as React from "react"
import { Loader2, RotateCcw, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FilterState } from "../types/table"

export interface SearchFieldOption {
  label: string
  value: string
}

export interface SearchFieldDef {
  key: string
  label: string
  type: "keyword" | "select"
  /** select 类型的选项；含"全部"语义时第一项传 { label: "全部", value: "" } */
  options?: SearchFieldOption[]
  placeholder?: string
  /** 字段占宽（grid 列数；默认 1，关键词默认 2） */
  span?: number
}

interface Props {
  fields: SearchFieldDef[]
  value: FilterState
  onChange: (next: FilterState) => void
  /** 点击"搜索"或关键词回车时触发（携带当前完整条件） */
  onSearch: (next: FilterState) => void
  loading?: boolean
  disabled?: boolean
  className?: string
}

const FULL = "__all__"

export function SearchToolbar({ fields, value, onChange, onSearch, loading = false, disabled = false, className }: Props) {
  const keywordField = fields.find((f) => f.type === "keyword")
  const selectFields = fields.filter((f) => f.type === "select")

  function setField(key: string, next: string) {
    const merged: FilterState = { ...value }
    if (next === "") delete merged[key]
    else merged[key] = next
    onChange(merged)
  }

  function submit() {
    if (loading || disabled) return
    onSearch({ ...value })
  }

  function reset() {
    const cleared: FilterState = {}
    onChange(cleared)
    onSearch(cleared)
  }

  const hasActive = Object.values(value).some((v) => v !== "" && v !== undefined)

  return (
    <form
      className={cn("flex flex-wrap items-end gap-x-4 gap-y-3", className)}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      role="search"
    >
      {keywordField ? (
        <div className={cn("min-w-0 flex-1 basis-56", keywordField.span === 2 ? "max-w-80" : "")}>
          <label
            htmlFor={`st-${keywordField.key}`}
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {keywordField.label}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id={`st-${keywordField.key}`}
              type="search"
              value={value[keywordField.key] ?? ""}
              onChange={(e) => setField(keywordField.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={keywordField.placeholder}
              disabled={disabled || loading}
              className={cn(
                "adm-input h-9 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm text-foreground transition-colors outline-none",
                "placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:bg-muted/60",
                "focus:border-primary focus:ring-2 focus:ring-ring/20",
              )}
            />
          </div>
        </div>
      ) : null}

      {selectFields.map((field) => (
        <div key={field.key} className="w-40">
          <label
            htmlFor={`st-${field.key}`}
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {field.label}
          </label>
          <div className="relative">
            <select
              id={`st-${field.key}`}
              value={value[field.key] ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              disabled={disabled || loading}
              className={cn(
                "adm-input h-9 w-full appearance-none rounded-md border border-input bg-card px-3 pr-8 text-sm text-foreground outline-none",
                "disabled:cursor-not-allowed disabled:bg-muted/60 focus:border-primary focus:ring-2 focus:ring-ring/20",
              )}
            >
              <option value="">{field.options?.[0]?.label ?? "全部"}</option>
              {(field.options ?? []).slice(1).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={disabled || loading}
          className={cn(
            "adm-touch-target adm-btn inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none",
            "hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
          )}
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          {loading ? "搜索中" : "搜索"}
        </button>
        {hasActive || !loading ? (
          <button
            type="button"
            onClick={reset}
            disabled={disabled || loading}
            className={cn(
              "adm-touch-target adm-btn inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors outline-none",
              "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
            )}
          >
            <RotateCcw className="size-4" aria-hidden />
            重置
          </button>
        ) : null}
      </div>
    </form>
  )
}

/** 导出供测试：判断条件是否已清空 */
export function isFilterEmpty(value: FilterState): boolean {
  return Object.values(value).every((v) => !v || v === FULL)
}
