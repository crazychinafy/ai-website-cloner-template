"use client"

// P5：useAdminSession —— 客户端获取当前管理员会话
// - 模块级单例 Promise：多个组件同时调用只发起一次请求（§17.10 防重复请求）
// - 登录后权限信息优先使用服务端组件下发的可信数据（layout props）；
//   本 hook 面向无服务端上下文的独立客户端组件
// - 不读取/不保存 Token（HttpOnly Cookie；浏览器 JS 不可见）

import * as React from "react"
import { adminApi } from "@/lib/admin/ui/api-client"
import type { AdminApiError, AdminSessionInfo } from "@/lib/admin/ui/api-client"

let sessionPromise: Promise<AdminSessionInfo> | null = null

/**
 * 获取当前会话（全局单例）。
 * 未登录（401）时 reject（调用方可据此处理）；
 * 注意：api-client 对 401 会触发登录页跳转（可传 onUnauthorized:false 的场景除外）。
 */
export function fetchAdminSession(): Promise<AdminSessionInfo> {
  if (!sessionPromise) {
    sessionPromise = adminApi
      .session()
      .then((res) => {
        if (!res.ok) {
          sessionPromise = null // 失败允许重试
          const err: AdminApiError = res.error
          throw new Error(err.message)
        }
        return res.data
      })
  }
  return sessionPromise
}

interface State {
  session: AdminSessionInfo | null
  loading: boolean
  error: string | null
}

export function useAdminSession(): State {
  const [state, setState] = React.useState<State>({ session: null, loading: true, error: null })

  React.useEffect(() => {
    let alive = true
    fetchAdminSession()
      .then((session) => {
        if (alive) setState({ session, loading: false, error: null })
      })
      .catch((e: Error) => {
        if (alive) setState({ session: null, loading: false, error: e.message })
      })
    return () => {
      alive = false
    }
  }, [])

  return state
}

/** 供测试/页面卸载后重置单例（避免跨路由串味） */
export function resetAdminSessionCache(): void {
  sessionPromise = null
}
