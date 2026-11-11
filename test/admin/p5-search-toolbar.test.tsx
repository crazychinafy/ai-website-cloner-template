// @vitest-environment happy-dom
// P5 测试：SearchToolbar（关键词回车 / 搜索按钮 / 下拉多条件 / 重置 / loading 防重复 / 无障碍）
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { SearchToolbar, type SearchFieldDef } from "../../src/components/admin/forms/SearchToolbar"
import type { FilterState } from "../../src/components/admin/types/table"
import { click, key, render, setInputValue } from "./dom"

const fields: SearchFieldDef[] = [
  { key: "keyword", label: "关键词", type: "keyword", placeholder: "输入标题或网址" },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: [
      { label: "全部", value: "" },
      { label: "已发布", value: "published" },
      { label: "未发布", value: "unpublished" },
    ],
  },
]

/** 状态驱动包装：每次筛选变更更新受控 value（DOM 断言依赖重渲染） */
function Host({
  onChangeSpy,
  onSearchSpy,
  loading = false,
  disabled = false,
}: {
  onChangeSpy: (f: FilterState) => void
  onSearchSpy: (f: FilterState) => void
  loading?: boolean
  disabled?: boolean
}) {
  const [filter, setFilter] = React.useState<FilterState>({})
  return (
    <SearchToolbar
      fields={fields}
      value={filter}
      onChange={(f) => {
        onChangeSpy(f)
        setFilter(f)
      }}
      onSearch={onSearchSpy}
      loading={loading}
      disabled={disabled}
    />
  )
}

const searchButton = () =>
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("搜索")) as HTMLButtonElement

describe("SearchToolbar 搜索流程（§10）", () => {
  it("1. 关键词输入 + 回车触发 onSearch（携带当前条件）", async () => {
    const onSearchSpy = vi.fn()
    const { unmount, settle } = render(<Host onChangeSpy={vi.fn()} onSearchSpy={onSearchSpy} />)
    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    setInputValue(input, "报名")
    await settle()
    key(input, "Enter")
    await settle()
    expect(onSearchSpy).toHaveBeenCalledTimes(1)
    expect(onSearchSpy).toHaveBeenCalledWith({ keyword: "报名" })
    unmount()
  })

  it("2. 下拉条件只触发 onChange；需搜索按钮才触发 onSearch", async () => {
    const onSearchSpy = vi.fn()
    const { unmount, settle } = render(<Host onChangeSpy={vi.fn()} onSearchSpy={onSearchSpy} />)
    const select = document.querySelector("select") as HTMLSelectElement
    setInputValue(select, "published")
    await settle()
    expect(onSearchSpy).not.toHaveBeenCalled()
    expect(select.value).toBe("published")
    click(searchButton())
    await settle()
    expect(onSearchSpy).toHaveBeenCalledTimes(1)
    expect(onSearchSpy).toHaveBeenCalledWith({ status: "published" })
    unmount()
  })

  it("3. 多条件组合：关键词 + 下拉均进入 onSearch", async () => {
    const onSearchSpy = vi.fn()
    const { unmount, settle } = render(<Host onChangeSpy={vi.fn()} onSearchSpy={onSearchSpy} />)
    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    const select = document.querySelector("select") as HTMLSelectElement
    setInputValue(input, "促销")
    await settle()
    setInputValue(select, "unpublished")
    await settle()
    click(searchButton())
    await settle()
    expect(onSearchSpy).toHaveBeenCalledWith({ keyword: "促销", status: "unpublished" })
    unmount()
  })

  it("4. 重置清空全部条件并触发 onSearch（父组件负责重置页码）", async () => {
    const onChangeSpy = vi.fn()
    const onSearchSpy = vi.fn()
    const { unmount, settle } = render(<Host onChangeSpy={onChangeSpy} onSearchSpy={onSearchSpy} />)
    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    setInputValue(input, "某个条件")
    await settle()
    const resetBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("重置")) as HTMLButtonElement
    expect(resetBtn).toBeTruthy() // 存在激活条件时重置按钮可见
    click(resetBtn)
    await settle()
    expect(onChangeSpy).toHaveBeenLastCalledWith({})
    expect(onSearchSpy).toHaveBeenLastCalledWith({})
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe("")
    unmount()
  })

  it("5. loading：控件禁用、搜索被忽略（防重复请求）", async () => {
    const onSearchSpy = vi.fn()
    const { unmount, settle } = render(<Host onChangeSpy={vi.fn()} onSearchSpy={onSearchSpy} loading />)
    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    const btn = searchButton()
    expect(input.disabled).toBe(true)
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)
    click(btn)
    key(input, "Enter")
    await settle()
    expect(onSearchSpy).not.toHaveBeenCalled()
    unmount()
  })

  it("6. 无障碍：form role=search；label 与输入框/下拉关联（htmlFor）", () => {
    const { unmount } = render(<Host onChangeSpy={vi.fn()} onSearchSpy={vi.fn()} />)
    expect(document.querySelector('form[role="search"]')).toBeTruthy()
    const input = document.querySelector('input[type="search"]') as HTMLInputElement
    const select = document.querySelector("select") as HTMLSelectElement
    const inputLabel = document.querySelector(`label[for="${input.id}"]`)
    const selectLabel = document.querySelector(`label[for="${select.id}"]`)
    expect(inputLabel?.textContent).toContain("关键词")
    expect(selectLabel?.textContent).toContain("状态")
    unmount()
  })
})
