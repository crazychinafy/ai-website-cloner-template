"use client"

// P5：修改密码表单（首次登录强制 / 用户主动修改共用）
// - POST /api/admin/v1/auth/change-password（统一 API Client + X-CSRF-Token，服务端实际合同）
// - 服务端成功后全部旧 Session 撤销并轮换新 Session → 整页替换到 returnTo || /admin
// - 策略（与 P3 服务端一致）：12-128 位；不在浏览器复刻弱口令表（服务端为准）

import * as React from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { FormField } from "./forms/FormField"
import { TextInput } from "./forms/TextInput"
import { adminApi, safeReturnTo } from "@/lib/admin/ui/api-client"
import { useToast } from "./feedback/ToastProvider"

interface Props {
  /** 服务端派生的 CSRF Token（页面由服务端注入，避免客户端重复请求 Session） */
  csrfToken: string
  /** 服务端校验过的安全回跳路径 */
  returnTo?: string | null
}

export function ChangePasswordForm({ csrfToken, returnTo }: Props) {
  const safeReturn = React.useMemo(() => safeReturnTo(returnTo), [returnTo])
  const { toast } = useToast()
  const [oldPassword, setOldPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPwd, setShowPwd] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [banner, setBanner] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<{
    oldPassword?: string
    newPassword?: string
    confirmPassword?: string
  }>({})

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return // 防重复提交
    setBanner(null)
    setFieldErrors({})

    if (!oldPassword || !newPassword || !confirmPassword) {
      setBanner("请填写完整")
      setFieldErrors({
        oldPassword: oldPassword ? undefined : "请输入当前密码",
        newPassword: newPassword ? undefined : "请输入新密码",
        confirmPassword: confirmPassword ? undefined : "请再次输入新密码",
      })
      return
    }
    if (newPassword.length < 12) {
      setFieldErrors({ newPassword: "新密码至少 12 位" })
      return
    }
    if (newPassword !== confirmPassword) {
      setBanner("两次输入的新密码不一致")
      setFieldErrors({ confirmPassword: "与上方新密码不一致" })
      return
    }

    setLoading(true)
    try {
      const res = await adminApi.changePassword({ oldPassword, newPassword, confirmPassword }, csrfToken)
      if (!res.ok) {
        const errs = res.error.fields ?? {}
        setBanner(res.error.message || "修改失败，请稍后重试")
        setFieldErrors({
          oldPassword: errs.oldPassword,
          newPassword: errs.newPassword,
          confirmPassword: errs.confirmPassword,
        })
        return
      }
      toast.success("密码修改成功")
      window.location.replace(safeReturn || "/admin")
    } catch {
      setBanner("网络异常，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  const eyeToggle = (
    <button
      type="button"
      onClick={() => setShowPwd((v) => !v)}
      disabled={loading}
      aria-label={showPwd ? "隐藏密码" : "显示密码"}
      aria-pressed={showPwd}
      className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {showPwd ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </button>
  )

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-7 flex flex-col items-center text-center">
        <h1 className="text-lg font-semibold text-foreground">修改密码</h1>
        <p className="mt-1 text-sm text-muted-foreground">新密码 12-128 位，建议避免常见口令</p>
      </div>

      {banner ? (
        <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
          {banner}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <FormField id="admin-old-pwd" label="当前密码" required error={fieldErrors.oldPassword} loading={loading} className="mb-4">
          <TextInput
            id="admin-old-pwd"
            type={showPwd ? "text" : "password"}
            autoComplete="current-password"
            maxLength={128}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            trailing={eyeToggle}
          />
        </FormField>
        <FormField
          id="admin-new-pwd"
          label="新密码"
          required
          error={fieldErrors.newPassword}
          description="12-128 位；修改后其他设备上的登录状态将全部失效"
          loading={loading}
          className="mb-4"
        >
          <TextInput
            id="admin-new-pwd"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            maxLength={128}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            trailing={eyeToggle}
            showCount
          />
        </FormField>
        <FormField
          id="admin-confirm-pwd"
          label="再次输入新密码"
          required
          error={fieldErrors.confirmPassword}
          loading={loading}
          className="mb-5"
        >
          <TextInput
            id="admin-confirm-pwd"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            maxLength={128}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            trailing={eyeToggle}
          />
        </FormField>

        <button
          type="submit"
          disabled={loading}
          className="adm-touch-target flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              提交中…
            </>
          ) : (
            "确认修改"
          )}
        </button>
      </form>
    </div>
  )
}
