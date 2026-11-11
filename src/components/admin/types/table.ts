// P5：DataTable 通用类型（泛型；服务端/客户端共用，无副作用）
// 任务书 §9.5：保证后续各业务模块（P6A-P6D）可以直接复用，不出现 any。

import type { ReactNode } from "react"

/** 排序方向 */
export type SortOrder = "asc" | "desc"

/** 服务端排序状态（组件只负责展示与触发 onStateChange；SQL 由服务端 allowlist 决定） */
export interface SortState {
  /** 排序字段（业务侧白名单键，如 "createdAt"） */
  field: string
  order: SortOrder
}

/** 服务端分页状态（page 从 1 开始） */
export interface PaginationState {
  page: number
  pageSize: number
}

/** 筛选条件（键值对；具体含义由业务模块的 SearchToolbar 定义） */
export type FilterState = Record<string, string>

/** 表格完整受控状态 */
export interface TableState {
  pagination: PaginationState
  sort: SortState | null
  filter: FilterState
}

/** 单列定义 */
export interface Column<T> {
  /** 唯一键（排序/操作引用） */
  key: string
  /** 表头（文案或自定义节点） */
  header: ReactNode
  /** 可排序（服务端排序；默认 false） */
  sortable?: boolean
  /** 对齐方式 */
  align?: "left" | "center" | "right"
  /** 列宽（CSS，如 "120px" / "minmax(160px, 1fr)"） */
  width?: string
  /** 单元格渲染；缺省时回退 row[key] 的字符串表示 */
  render?: (row: T) => ReactNode
  /** 单元格 className */
  className?: string
}

/** 服务端分页查询结果 */
export interface PageResult<T> {
  items: T[]
  total: number
}

/** 每页条数选项（UI 层强制 20/50/100，最大 100；服务端保留后续校验） */
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number]
export const DEFAULT_PAGE_SIZE: PageSizeOption = 20

/** UI 层限制：只接受 20/50/100，其余回退默认 20（服务端仍会独立校验） */
export function clampPageSize(value: number): PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value) ? (value as PageSizeOption) : DEFAULT_PAGE_SIZE
}

/** 总页数（向上取整；total 非正时 = 0） */
export function totalPages(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0 || pageSize <= 0) return 0
  return Math.ceil(total / pageSize)
}

/** 页码钳制（1..max(1, totalPages)） */
export function clampPage(page: number, total: number, pageSize: number): number {
  const max = Math.max(1, totalPages(total, pageSize))
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(page, max)
}

/** 默认表格状态 */
export function defaultTableState(filter: FilterState = {}): TableState {
  return {
    pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE },
    sort: null,
    filter,
  }
}
