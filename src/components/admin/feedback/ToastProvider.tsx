"use client"

// P5：全局 Toast 消息系统（后台专属，与前台 facai8 Toast 完全独立）
// ─────────────────────────────────────────────────────────────────
// - 四种类型：success / error / warning / info
// - 自动关闭（可配）+ 手动关闭；最多同屏 4 条，新消息挤出最旧（防堆积）
// - 容器 aria-live：info/success/warning = polite，error = assertive
// - Toast 只负责展示：不执行业务请求，不读取/打印 token 类敏感数据
// - 挂载一次（后台根布局），不随路由变化重建

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ToastContainer } from "./ToastContainer"

export type ToastType = "success" | "error" | "warning" | "info"

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

export interface ToastOptions {
  /** 自动关闭毫秒数；缺省按类型（error 6s，其余 4.5s）；传 0 表示不自动关闭 */
  duration?: number
}

export interface ToastApi {
  success: (message: string, opts?: ToastOptions) => void
  error: (message: string, opts?: ToastOptions) => void
  warning: (message: string, opts?: ToastOptions) => void
  info: (message: string, opts?: ToastOptions) => void
  /** 手动关闭指定 toast */
  dismiss: (id: number) => void
  /** 清空全部 */
  clear: () => void
}

const MAX_VISIBLE = 4

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4500,
  error: 6000,
  warning: 5000,
  info: 4500,
}

const ToastCtx = React.createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setItems((cur) => cur.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (type: ToastType, message: string, opts?: ToastOptions) => {
      const duration = opts?.duration ?? DEFAULT_DURATION[type]
      const id = ++nextId.current
      setItems((cur) => {
        // 防堆积：超出上限时挤掉最旧的
        const base = cur.length >= MAX_VISIBLE ? cur.slice(cur.length - MAX_VISIBLE + 1) : cur
        return [...base, { id, type, message }]
      })
      if (duration > 0) {
        const existing = timers.current.get(id)
        if (existing) clearTimeout(existing)
        timers.current.set(id, setTimeout(() => dismiss(id), duration))
      }
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      warning: (m, o) => push("warning", m, o),
      info: (m, o) => push("info", m, o),
      dismiss,
      clear: () => {
        for (const t of timers.current.values()) clearTimeout(t)
        timers.current.clear()
        setItems([])
      },
    }),
    [push, dismiss],
  )

  // 卸载时清理所有未触发的自动关闭定时器
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastContainer items={items} onDismiss={dismiss} />
    </ToastCtx.Provider>
  )
}

/** 在任意后台客户端组件中调用：const { toast } = useToast() */
export function useToast(): { toast: ToastApi } {
  const ctx = React.useContext(ToastCtx)
  if (!ctx) {
    throw new Error("useToast 必须在 <ToastProvider>（后台布局）内使用")
  }
  return { toast: ctx }
}
