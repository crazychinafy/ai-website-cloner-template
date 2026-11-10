"use client"

// 注销按钮（客户端）：POST /api/admin/v1/auth/logout（携带 CSRF）→ 整页替换到登录页
// （replace：历史栈不保留后台页面，防"后退"回到已失效的后台视图）
import { useState } from "react"

export function LogoutButton({ csrfToken }: { csrfToken: string }) {
  const [loading, setLoading] = useState(false)

  async function onLogout() {
    if (loading) return
    setLoading(true)
    try {
      await fetch("/api/admin/v1/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: "{}",
      })
    } catch {
      /* 即便网络失败也跳转（服务端 Session 仍会被 TTL 过期兜底） */
    }
    window.location.replace("/admin/login")
  }

  return (
    <button type="button" className="admin-btn admin-btn-ghost" onClick={onLogout} disabled={loading}>
      {loading ? "退出中…" : "退出登录"}
    </button>
  )
}
