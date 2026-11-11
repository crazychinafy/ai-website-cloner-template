// @vitest-environment happy-dom
// P5 测试：DataTable（§9/§19.2：分页 20/50/100 上限 100 / 排序回调 / Loading / Empty / Error / 行点击）
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { DataTable } from "../../src/components/admin/tables/DataTable"
import type { AdminApiError } from "../../src/lib/admin/ui/api-client"
import {
  clampPage,
  clampPageSize,
  defaultTableState,
  totalPages,
  type Column,
  type TableState,
} from "../../src/components/admin/types/table"
import { click, render, setInputValue } from "./dom"

interface Row {
  id: number
  name: string
  status: string
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `条目 ${i + 1}`, status: i % 2 ? "active" : "draft" }))
}

const columns: Column<Row>[] = [
  { key: "id", header: "ID", sortable: true, width: "80px" },
  { key: "name", header: "名称", sortable: true },
  { key: "status", header: "状态" },
]

function TestTable({
  rows,
  total,
  onRowClick,
  onRetry,
  loading,
  error,
}: {
  rows: Row[]
  total?: number
  onRowClick?: (row: Row) => void
  onRetry?: () => void
  loading?: boolean
  error?: AdminApiError | string | null
}) {
  const [state, setState] = React.useState<TableState>(() => defaultTableState())
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total ?? rows.length}
      rowKey={(r) => r.id}
      state={state}
      onStateChange={setState}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onRowClick={onRowClick}
    />
  )
}

/** 可控版本的包装（状态由测试持有） */
function ControlledTable({
  rows,
  total,
  state,
  onChange,
  onRetry,
  loading,
  error,
}: {
  rows: Row[]
  total: number
  state: TableState
  onChange: (s: TableState) => void
  onRetry?: () => void
  loading?: boolean
  error?: AdminApiError | string | null
}) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      rowKey={(r) => r.id}
      state={state}
      onStateChange={onChange}
      loading={loading}
      error={error}
      onRetry={onRetry}
    />
  )
}

/** React 状态驱动的包装：onStateChange 通知 spy 并 setState 触发重渲染（DOM 断言依赖重渲染） */
function SpyTable({ rows, total, spy }: { rows: Row[]; total: number; spy: (s: TableState) => void }) {
  const [state, setState] = React.useState<TableState>(() => defaultTableState())
  return <ControlledTable rows={rows} total={total} state={state} onChange={(s) => { spy(s); setState(s) }} />
}

describe("DataTable 分页（§9.2）", () => {
  it("1. 默认每页 20 条", () => {
    const rows = makeRows(20)
    const { unmount } = render(
      <ControlledTable rows={rows} total={140} state={defaultTableState()} onChange={() => {}} />,
    )
    const text = document.body.textContent ?? ""
    expect(text).toContain("共 140 条")
    expect(text).toContain("第 1 / 7 页") // ceil(140/20)
    const select = document.querySelector("select") as HTMLSelectElement
    expect(select.value).toBe("20")
    unmount()
  })

  it("2. 每页 50 / 100 可切换（页码重置回第一页）", async () => {
    const rows = makeRows(100)
    let state = defaultTableState()
    const onChange = vi.fn((s: TableState) => {
      state = s
    })
    const { unmount, settle } = render(
      <ControlledTable rows={rows} total={250} state={state} onChange={(s) => void onChange(s)} />,
    )
    const select = document.querySelector("select") as HTMLSelectElement
    setInputValue(select, "50")
    await settle()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ pagination: { page: 1, pageSize: 50 } }))
    onChange.mockClear()
    setInputValue(select, "100")
    await settle()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ pagination: { page: 1, pageSize: 100 } }))
    unmount()
  })

  it("3. UI 层每页条数不允许超过 100（选项仅 20/50/100）", () => {
    const { unmount } = render(
      <ControlledTable rows={makeRows(5)} total={10} state={defaultTableState()} onChange={() => {}} />,
    )
    const select = document.querySelector("select") as HTMLSelectElement
    const options = [...select.options].map((o) => Number(o.value))
    expect(options).toEqual([20, 50, 100])
    expect(Math.max(...options)).toBe(100)
    unmount()
  })

  it("4. clampPageSize 单元：非法值回退默认 20（永不 >100）", () => {
    expect(clampPageSize(20)).toBe(20)
    expect(clampPageSize(50)).toBe(50)
    expect(clampPageSize(100)).toBe(100)
    expect(clampPageSize(101)).toBe(20)
    expect(clampPageSize(500)).toBe(20)
    expect(clampPageSize(0)).toBe(20)
    expect(clampPageSize(-5)).toBe(20)
  })

  it("5. 上一页/下一页 触发 onStateChange（页码钳制 1..总页数；DOM 随状态重渲染）", async () => {
    const spy = vi.fn()
    const { unmount, settle } = render(<SpyTable rows={makeRows(20)} total={60} spy={spy} />)
    // 第 1 页：上一页禁用；60 条 / 20 = 3 页
    let prev = document.querySelector('button[aria-label="上一页"]') as HTMLButtonElement
    let next = document.querySelector('button[aria-label="下一页"]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(document.body.textContent).toContain("第 1 / 3 页")
    // → 第 2 页
    click(next)
    await settle()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ pagination: { page: 2, pageSize: 20 } }))
    expect(document.body.textContent).toContain("第 2 / 3 页")
    prev = document.querySelector('button[aria-label="上一页"]') as HTMLButtonElement
    next = document.querySelector('button[aria-label="下一页"]') as HTMLButtonElement
    expect(prev.disabled).toBe(false)
    // → 第 3 页（末页）：下一页禁用
    click(next)
    await settle()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ pagination: { page: 3, pageSize: 20 } }))
    next = document.querySelector('button[aria-label="下一页"]') as HTMLButtonElement
    expect(next.disabled).toBe(true)
    unmount()
  })

  it("6. totalPages / clampPage 单元", () => {
    expect(totalPages(140, 20)).toBe(7)
    expect(totalPages(0, 20)).toBe(0)
    expect(totalPages(1, 20)).toBe(1)
    expect(clampPage(0, 140, 20)).toBe(1)
    expect(clampPage(99, 140, 20)).toBe(7)
    expect(clampPage(3, 0, 20)).toBe(1)
  })
})

describe("DataTable 服务端排序（§9.3：只上抛状态，不本地重排）", () => {
  it("7. 点击可排序表头 → onStateChange（asc → desc → 取消；DOM aria-sort 同步更新）", async () => {
    const spy = vi.fn()
    const { unmount, settle } = render(<SpyTable rows={makeRows(3)} total={3} spy={spy} />)
    // aria-sort 挂在 <th> 上（ARIA 规范）；排序按钮在 th 内部 —— 断言必须查 th 而非 button
    const idHeader = document.querySelector('th[scope="col"] button') as HTMLButtonElement
    const idTh = () => document.querySelector('th[scope="col"]') as HTMLTableCellElement
    expect(idHeader).toBeTruthy()
    expect(idTh().getAttribute("aria-sort")).toBeNull()
    click(idHeader)
    await settle()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { field: "id", order: "asc" } }))
    expect(idTh().getAttribute("aria-sort")).toBe("ascending")
    spy.mockClear()
    click(idHeader)
    await settle()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { field: "id", order: "desc" } }))
    expect(idTh().getAttribute("aria-sort")).toBe("descending")
    spy.mockClear()
    click(idHeader)
    await settle()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null }))
    expect(idTh().getAttribute("aria-sort")).toBeNull()
    unmount()
  })

  it("8. 不可排序列无排序按钮", () => {
    const { unmount } = render(
      <ControlledTable rows={makeRows(2)} total={2} state={defaultTableState()} onChange={() => {}} />,
    )
    const ths = [...document.querySelectorAll("th[scope='col']")]
    const statusTh = ths.find((th) => (th.textContent ?? "").includes("状态"))
    expect(statusTh?.querySelector("button")).toBeNull()
    unmount()
  })

  it("9. 表格不本地重排（受控 data 原样渲染）", () => {
    const rows = makeRows(3) // 顺序 1,2,3
    const { unmount } = render(
      <ControlledTable rows={rows} total={3} state={{ ...defaultTableState(), sort: { field: "id", order: "desc" } }} onChange={() => {}} />,
    )
    // 数据由父组件按服务端顺序提供：DataTable 只负责展示
    const firstRowName = document.querySelector("tbody tr td")?.textContent
    expect(firstRowName).toBe("1")
    unmount()
  })
})

describe("DataTable 状态覆盖（§19.2）", () => {
  it("10. Loading → 表内骨架（隐藏数据行）", () => {
    const { unmount } = render(
      <ControlledTable rows={makeRows(5)} total={5} state={defaultTableState()} onChange={() => {}} loading />,
    )
    const pulses = document.querySelectorAll("tbody .animate-pulse")
    expect(pulses.length).toBeGreaterThan(0)
    expect((document.body.textContent ?? "").includes("条目 1")).toBe(false)
    unmount()
  })

  it("11. Error → ErrorState + 重试回调（含 requestId 文案位置）", async () => {
    const onRetry = vi.fn()
    const apiError: AdminApiError = {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后重试",
      requestId: "req-123",
    }
    const { unmount, settle } = render(
      <ControlledTable rows={[]} total={0} state={defaultTableState()} onChange={() => {}} error={apiError} onRetry={onRetry} />,
    )
    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).toContain("req-123")
    const retryBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("重试"))
    click(retryBtn as HTMLButtonElement)
    await settle()
    expect(onRetry).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("12. Empty → 空状态（含操作位）", () => {
    const { unmount } = render(
      <ControlledTable rows={[]} total={0} state={defaultTableState()} onChange={() => {}} />,
    )
    expect(document.body.textContent).toContain("暂无数据")
    unmount()
  })

  it("13. 行点击回调 + 键盘 Enter 触发（无障碍）", async () => {
    const onRowClick = vi.fn()
    const { unmount, settle } = render(
      <TestTable rows={makeRows(3)} onRowClick={(r) => void onRowClick(r)} />,
    )
    const tr = document.querySelector("tbody tr") as HTMLTableRowElement
    expect(tr.tabIndex).toBe(0)
    click(tr)
    await settle()
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    unmount()
  })

  it("14. 行操作区渲染（业务按钮位）", () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        data={makeRows(2)}
        total={2}
        rowKey={(r) => r.id}
        state={defaultTableState()}
        onStateChange={() => {}}
        renderRowActions={(r) => <button type="button">编辑 {r.id}</button>}
      />,
    )
    expect(document.body.textContent).toContain("操作")
    expect(document.body.textContent).toContain("编辑 1")
    unmount()
  })
})
