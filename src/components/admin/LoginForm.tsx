"use client"

// 管理员登录表单（客户端）：提交 POST /api/admin/v1/auth/login
// - 显示/隐藏密码、加载态、防重复提交、错误提示
// - 成功后按 mustChangePassword 跳转 /admin 或 /admin/change-password
// - 不读取、不存储任何 token（Session 只存在于 HttpOnly Cookie）
import { useState } from "react"

interface LoginResponse {
  success: boolean
  data?: {
    id: string
    username: string
    displayName: string
    mustChangePassword: boolean
  }
  error?: { code: string; message: string }
}

export function LoginForm() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return // 防重复提交
    setError(null)
    if (!username.trim() || !password) {
      setError("请输入用户名和密码")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/admin/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const json = (await res.json()) as LoginResponse
      if (!json.success || !json.data) {
        setError(json.error?.message ?? "登录失败，请稍后重试")
        return
      }
      // 整页替换跳转（服务端 Session 已通过 Cookie 建立；replace 不保留登录表单历史）
      window.location.replace(json.data.mustChangePassword ? "/admin/change-password" : "/admin")
    } catch {
      setError("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-card">
      <h1>管理员登录</h1>
      <p className="admin-sub">彩搜搜管理后台</p>

      {error ? <div className="admin-error">{error}</div> : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="admin-field">
          <label htmlFor="admin-username">用户名</label>
          <input
            id="admin-username"
            className="admin-input"
            type="text"
            autoComplete="username"
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            placeholder="请输入管理员用户名"
          />
        </div>

        <div className="admin-field">
          <label htmlFor="admin-password">密码</label>
          <div className="admin-inputwrap">
            <input
              id="admin-password"
              className="admin-input"
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="请输入密码"
            />
            <button type="button" className="admin-eye" onClick={() => setShowPwd((v) => !v)} disabled={loading}>
              {showPwd ? "隐藏" : "显示"}
            </button>
          </div>
        </div>

        <button type="submit" className="admin-btn" disabled={loading}>
          {loading ? "登录中…" : "登 录"}
        </button>
      </form>

      <p className="admin-note">仅限授权管理员访问；登录失败次数过多将临时限制</p>
    </div>
  )
}
