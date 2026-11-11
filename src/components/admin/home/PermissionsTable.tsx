"use client"

// 工作台：当前会话权限表（真实 Session 数据；全量已在内存 → 本地排序/分页是真实的"全局"操作）

import * as React from "react"
import { DataTable } from "../tables/DataTable"
import type { Column, PageResult, TableState } from "../types/table"
import { defaultTableState } from "../types/table"

interface PermRow {
  code: string
  resource: string
  action: string
}

interface Props {
  permissions: string[]
}

export function PermissionsTable({ permissions }: Props) {
  const [state, setState] = React.useState<TableState>(() => defaultTableState())

  const rows: PermRow[] = React.useMemo(
    () =>
      [...permissions]
        .sort()
        .map((code) => {
          const i = code.indexOf(".")
          return { code, resource: i >= 0 ? code.slice(0, i) : code, action: i >= 0 ? code.slice(i + 1) : "" }
        }),
    [permissions],
  )

  // 本地（全量在内存）排序 + 切片
  const view: PageResult<PermRow> = React.useMemo(() => {
    let sorted = rows
    if (state.sort) {
      const dir = state.sort.order === "asc" ? 1 : -1
      const key = state.sort.field as keyof PermRow
      sorted = [...rows].sort((a, b) => {
        const av = a[key]
        const bv = b[key]
        if (av === bv) return 0
        return av > bv ? dir : -dir
      })
    }
    const { page, pageSize } = state.pagination
    const start = (page - 1) * pageSize
    return { items: sorted.slice(start, start + pageSize), total: sorted.length }
  }, [rows, state])

  const columns = React.useMemo<Column<PermRow>[]>(
    () => [
      {
        key: "code",
        header: "权限代码",
        sortable: true,
        width: "280px",
        render: (row) => <code className="font-mono text-[13px] text-foreground">{row.code}</code>,
      },
      { key: "resource", header: "资源", sortable: true, width: "140px" },
      { key: "action", header: "动作", width: "120px", align: "right" },
    ],
    [],
  )

  return (
    <DataTable<PermRow>
      columns={columns}
      data={view.items}
      total={view.total}
      rowKey={(row) => row.code}
      state={state}
      onStateChange={setState}
      ariaLabel="当前会话权限"
      emptyTitle="当前会话无权限"
      emptyDescription="该管理员未分配任何权限，仅可访问工作台。"
    />
  )
}
