// @vitest-environment happy-dom
// P5 测试：ConfirmDialog（打开 / 确认 / 取消 / ESC / loading 防重复与锁关闭 / 焦点安全默认）
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "../../src/components/admin/dialogs/ConfirmDialog"
import { click, key, render } from "./dom"

function Host({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
  confirmDisabled = false,
  defaultFocus = "cancel",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  loading?: boolean
  confirmDisabled?: boolean
  defaultFocus?: "cancel" | "confirm"
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="删除该条目"
      description="删除后不可恢复，请确认。"
      confirmLabel="确认删除"
      cancelLabel="取消"
      danger
      loading={loading}
      confirmDisabled={confirmDisabled}
      defaultFocus={defaultFocus}
      onConfirm={onConfirm}
    />
  )
}

/** 打开/关闭状态由内部持有的宿主（模拟父组件） */
function OpenHost({
  loading = false,
  onConfirm,
  onOpenChange,
}: {
  loading?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(true)
  return (
    <Host
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        onOpenChange(o)
      }}
      onConfirm={onConfirm}
      loading={loading}
    />
  )
}

describe("ConfirmDialog 打开与展示（§11）", () => {
  it("1. 未打开时不渲染任何弹窗内容（受控 open=false）", () => {
    const { unmount } = render(<Host open={false} onOpenChange={() => {}} onConfirm={() => {}} />)
    const text = document.body.textContent ?? ""
    expect(text).not.toContain("删除该条目")
    expect(text).not.toContain("确认删除")
    unmount()
  })

  it("2. 打开后渲染标题/描述/双按钮（危险操作）", () => {
    const { unmount } = render(<Host open onOpenChange={() => {}} onConfirm={() => {}} />)
    const text = document.body.textContent ?? ""
    expect(text).toContain("删除该条目")
    expect(text).toContain("删除后不可恢复，请确认。")
    expect(text).toContain("确认删除")
    expect(text).toContain("取消")
    unmount()
  })

  it("3. 打开后焦点移到\"取消\"（安全默认，防 Enter 误确认）", async () => {
    const { unmount, settle } = render(<Host open onOpenChange={() => {}} onConfirm={() => {}} />)
    await settle()
    const active = document.activeElement as HTMLElement | null
    expect(active?.textContent).toBe("取消")
    unmount()
  })

  it("4. defaultFocus=confirm 时焦点移到确认按钮", async () => {
    const { unmount, settle } = render(<Host open defaultFocus="confirm" onOpenChange={() => {}} onConfirm={() => {}} />)
    await settle()
    const active = document.activeElement as HTMLElement | null
    expect(active?.textContent).toBe("确认删除")
    unmount()
  })
})

describe("ConfirmDialog 交互（§11）", () => {
  it("5. 点击确认 → onConfirm 执行", async () => {
    const onConfirm = vi.fn()
    const { unmount, settle } = render(
      <OpenHost onConfirm={onConfirm} onOpenChange={() => {}} />,
    )
    await settle()
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("确认删除")) as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    click(confirmBtn)
    await settle()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("6. 点击取消 → onOpenChange(false)（弹窗关闭）", async () => {
    const onOpenChange = vi.fn()
    const { unmount, settle } = render(<OpenHost onConfirm={() => {}} onOpenChange={onOpenChange} />)
    await settle()
    const cancelBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "取消") as HTMLButtonElement
    expect(cancelBtn).toBeTruthy()
    click(cancelBtn)
    await settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    const text = document.body.textContent ?? ""
    expect(text).not.toContain("删除该条目")
    unmount()
  })

  it("7. ESC 关闭（受控 onOpenChange(false)）", async () => {
    const onOpenChange = vi.fn()
    const { unmount, settle } = render(<OpenHost onConfirm={() => {}} onOpenChange={onOpenChange} />)
    await settle()
    key(document, "Escape")
    await settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    unmount()
  })
})

describe("ConfirmDialog loading 防误触（§11）", () => {
  it("8. loading：双按钮禁用，点击确认不触发 onConfirm（防重复提交）", async () => {
    const onConfirm = vi.fn()
    const { unmount, settle } = render(<Host open loading onOpenChange={() => {}} onConfirm={onConfirm} />)
    await settle()
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("处理中")) as HTMLButtonElement
    const cancelBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "取消") as HTMLButtonElement
    expect(confirmBtn?.disabled).toBe(true)
    expect(cancelBtn?.disabled).toBe(true)
    click(confirmBtn as HTMLButtonElement)
    click(cancelBtn as HTMLButtonElement)
    await settle()
    expect(onConfirm).not.toHaveBeenCalled()
    unmount()
  })

  it("9. loading 期间 ESC 不关闭（preventUnmountOnClose；弹窗保留）", async () => {
    const onOpenChange = vi.fn()
    const { unmount, settle } = render(<OpenHost loading onConfirm={() => {}} onOpenChange={onOpenChange} />)
    await settle()
    key(document, "Escape")
    await settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("处理中") // 弹窗仍在
    unmount()
  })

  it("10. confirmDisabled（父组件业务禁用）→ 确认按钮禁用", async () => {
    const onConfirm = vi.fn()
    const { unmount, settle } = render(<Host open confirmDisabled onOpenChange={() => {}} onConfirm={onConfirm} />)
    await settle()
    const confirmBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("确认删除")) as HTMLButtonElement
    expect(confirmBtn?.disabled).toBe(true)
    click(confirmBtn as HTMLButtonElement)
    await settle()
    expect(onConfirm).not.toHaveBeenCalled()
    unmount()
  })
})
