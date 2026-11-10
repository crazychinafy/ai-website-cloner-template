"use client"

// 修改密码表单（客户端）：提交 POST /api/admin/v1/auth/change-password
// - 携带 X-CSRF-Token（挂载时从 /api/admin/v1/auth/session 获取）
// - 成功后服务端返回轮换后的新 Cookie → 跳转后台首页
import { useEffect, useState } from "react"

interface SessionResponse {
  success: boolean
  data?: { csrfToken: string }
  error?: { code: string; message: string }
}

interface ChangePasswordResponse {
  success: boolean
  data?: { mustChangePassword: boolean }
  error?: { code: string; message: string }
}

export function ChangePasswordForm() {
  const [csrfToken, setCsrfToken] = useState("")
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 挂载时获取当前会话的 CSRF token（服务端由 Session 派生，客户端仅透传）
  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/v1/auth/session", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as SessionResponse
        if (!cancelled && json.success && json.data) setCsrfToken(json.data.csrfToken)
      })
      .catch(() => {
        /* 获取失败 → 提交时服务端会 401/403，届时统一报错 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return // 防重复提交
    setError(null)
    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("请填写完整")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/admin/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      })
      const json = (await res.json()) as ChangePasswordResponse
      if (!json.success) {
        setError(json.error?.message ?? "修改失败，请稍后重试")
        return
      }
      window.location.replace("/admin")
    } catch {
      setError("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-card">
      <h1>修改密码</h1>
      <p className="admin-sub">
        {newPassword.length >= 12 ? "新密码 12-128 位，避免常见弱口令" : "新密码至少 12 位"}
      </p>

      {error ? <div className="admin-error">{error}</div> : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="admin-field">
          <label htmlFor="admin-old-pwd">当前密码</label>
          <div className="admin-inputwrap">
            <input
              id="admin-old-pwd"
              className="admin-input"
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              maxLength={128}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              disabled={loading}
            />
            <button type="button" className="admin-eye" onClick={() => setShowPwd((v) => !v)} disabled={loading}>
              {showPwd ? "隐藏" : "显示"}
            </button>
          </div>
        </div>

        <div className="admin-field">
          <label htmlFor="admin-new-pwd">新密码</label>
          <input
            id="admin-new-pwd"
            className="admin-input"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            maxLength={128}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="admin-confirm-pwd">再次输入新密码</label>
          <input
            id="admin-confirm-pwd"
            className="admin-input"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            maxLength={128}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <button type="submit" className="admin-btn" disabled={loading}>
          {loading ? "提交中…" : "确认修改"}
        </button>
      </form>

      <p className="admin-note">修改成功后其他设备上的登录状态将全部失效</p>
    </div>
  )
}
