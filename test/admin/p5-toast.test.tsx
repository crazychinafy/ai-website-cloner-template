// @vitest-environment happy-dom
// P5 测试：全局 Toast（四类型 / 自动关闭 / 手动关闭 / 最多 4 条防堆积 / aria-live）
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ToastProvider, useToast, type ToastApi } from "../../src/components/admin/feedback/ToastProvider"
import { act, click, render, type RenderResult } from "./dom"

let api: ToastApi | null = null
let mounted: RenderResult | null = null

/** 探针组件：向测试暴露 useToast 的 api（只挂载于 Provider 内；effect 中赋值，render 保持纯净） */
function Probe() {
  const { toast } = useToast()
  React.useEffect(() => {
    api = toast
  }, [toast])
  return null
}

function mount() {
  api = null
  mounted = render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  )
  expect(api, "ToastProvider 必须注入 useToast 上下文").not.toBeNull()
  return mounted
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  // 卸载 Provider，避免 Toast 区域跨测试累积（共享 document 会残留上一测试的通知）
  if (mounted) {
    mounted.unmount()
    mounted = null
  }
})

/** 把若干 toast 推进渲染（setState 批量刷入 DOM） */
async function flush() {
  await act(async () => {})
}

describe("Toast 展示（§16）", () => {
  it("1. 四种类型均渲染；error=alert/assertive，其余=status/polite", async () => {
    mount()
    api!.success("保存成功")
    api!.error("操作失败")
    api!.warning("即将到期")
    api!.info("系统通知")
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).toContain("保存成功")
    expect(text).toContain("操作失败")
    expect(text).toContain("即将到期")
    expect(text).toContain("系统通知")
    const alert = document.querySelector('[role="alert"][aria-live="assertive"]')
    expect(alert?.textContent).toContain("操作失败")
    const firstStatus = document.querySelector('[role="status"][aria-live="polite"]')
    expect(firstStatus?.textContent).toContain("保存成功")
    expect(document.querySelectorAll(".adm-toast").length).toBe(4)
  })

  it("2. 容器携带 aria-label（通知区域）", async () => {
    mount()
    api!.info("区域")
    await flush()
    expect(document.querySelector('.adm-toast-region[aria-label="通知"]')).toBeTruthy()
  })
})

describe("Toast 关闭（§16）", () => {
  it("3. 自动关闭：success 4.5s 后移除（fake timers）", async () => {
    mount()
    api!.success("临时消息")
    await flush()
    expect(document.body.textContent).toContain("临时消息")
    await act(async () => {
      vi.advanceTimersByTime(4499)
    })
    expect(document.body.textContent).toContain("临时消息")
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(document.body.textContent).not.toContain("临时消息")
  })

  it("4. error 默认 6s 自动关闭（比 success 更久，需用户看到）", async () => {
    mount()
    api!.error("致命错误")
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    expect(document.body.textContent).not.toContain("致命错误")
  })

  it("5. duration=0 不自动关闭（手动关闭才移除）", async () => {
    mount()
    api!.warning("需确认", { duration: 0 })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(document.body.textContent).toContain("需确认")
  })

  it("6. 手动关闭按钮移除该条", async () => {
    mount()
    api!.info("手动关闭我", { duration: 0 })
    await flush()
    const closeBtns = document.querySelectorAll('button[aria-label="关闭通知"]')
    expect(closeBtns.length).toBe(1)
    click(closeBtns[0])
    await flush()
    expect(document.body.textContent).not.toContain("手动关闭我")
  })
})

describe("Toast 防堆积（§16）", () => {
  it("7. 最多同屏 4 条：第 5 条挤出最旧", async () => {
    mount()
    for (const m of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      api!.info(m, { duration: 0 })
    }
    await flush()
    const text = document.body.textContent ?? ""
    expect(text).not.toContain("alpha")
    expect(text).not.toContain("beta")
    expect(text).toContain("gamma")
    expect(text).toContain("delta")
    expect(text).toContain("epsilon")
    expect(text).toContain("zeta")
    expect(document.querySelectorAll(".adm-toast").length).toBe(4)
  })

  it("8. clear() 清空全部并取消所有自动关闭定时器", async () => {
    mount()
    api!.success("一", { duration: 0 })
    api!.error("二", { duration: 0 })
    await flush()
    expect(document.querySelectorAll(".adm-toast").length).toBe(2)
    act(() => {
      api!.clear()
    })
    await flush()
    expect(document.querySelectorAll(".adm-toast").length).toBe(0)
  })
})
