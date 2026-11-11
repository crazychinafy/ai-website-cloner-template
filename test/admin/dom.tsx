// P5 组件测试 DOM 辅助（happy-dom 环境；由各 .test.tsx 文件声明 @vitest-environment happy-dom）
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach } from "vitest"

// React 19 act 环境标记（vitest 全局）
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export { act }

export interface RenderResult {
  container: HTMLElement
  unmount: () => void
  /** 等待一个微任务排空（异步 setState 后；调用方必须 await） */
  settle: () => Promise<void>
}

/** 安全网：登记全部挂载；断言中途抛错导致 unmount 未执行时由 afterEach 兜底卸载 */
const MOUNTS: RenderResult[] = []

export function render(ui: React.ReactElement): RenderResult {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  const result: RenderResult = {
    container: document.body,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
    settle: () =>
      act(async () => {
        await Promise.resolve()
      }),
  }
  MOUNTS.push(result)
  return result
}

/** 触发键盘事件（冒泡；document 用于全局 ESC 等） */
export function key(target: Element | Document, keyName: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }))
  })
}

/** 点击（冒泡） */
export function click(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

/** 设置 input/select 值并触发（React 受控组件需用 native setter 绕过 value tracker） */
export function setInputValue(target: HTMLInputElement | HTMLSelectElement, value: string): void {
  act(() => {
    const proto = Object.getPrototypeOf(target)
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
    if (desc?.set) {
      desc.set.call(target, value)
    } else {
      ;(target as HTMLInputElement).value = value
    }
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

// 兜底清理：无论测试如何结束（含断言抛错），共享 document 不残留挂载。
// 注册在辅助模块中，对每个 import 本文件的测试文件生效（重复 unmount 为空操作，安全）。
afterEach(() => {
  while (MOUNTS.length > 0) {
    MOUNTS.pop()!.unmount()
  }
})
