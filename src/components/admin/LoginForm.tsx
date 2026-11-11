"use client"

// P5：管理员登录表单（独立 /admin/login，不复用前台会员 /login）
// - 提交 POST /api/admin/v1/auth/login（统一 API Client；Origin/限流/CSRF 由服务端执行）
// - 密码显示/隐藏、必填校验、Loading 防重复提交、失败提示（不泄露账号是否存在）
// - 成功后整页替换跳转：mustChangePassword → /admin/change-password；否则 returnTo || /admin
// - returnTo 仅接受服务端已校验的 /admin 站内相对路径（禁止开放重定向）
// - 不读取/不存储 Token（HttpOnly Cookie）；不在控制台输出密码

import * as React from "react"
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react"
import { FormField } from "./forms/FormField"
import { TextInput } from "./forms/TextInput"
import { adminApi, safeReturnTo } from "@/lib/admin/ui/api-client"
import { useToast } from "./feedback/ToastProvider"

interface LoginSuccess {
  id: string
  username: string
  displayName: string
  mustChangePassword: boolean
}

interface Props {
  /** 服务端校验过的安全回跳路径（/admin 前缀相对路径） */
  returnTo?: string | null
}

export function LoginForm({ returnTo }: Props) {
  const safeReturn = React.useMemo(() => safeReturnTo(returnTo), [returnTo])
  const { toast } = useToast()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPwd, setShowPwd] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [banner, setBanner] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<{ username?: string; password?: string }>({})

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return // 防重复提交
    setBanner(null)
    setFieldErrors({})

    const uname = username.trim()
    if (!uname || !password) {
      setBanner("请输入用户名和密码")
      setFieldErrors(!uname ? { username: "请输入用户名" } : { password: "请输入密码" })
      return
    }

    setLoading(true)
    try {
      const res = await adminApi.login(uname, password)
      if (!res.ok) {
        const errs = res.error.fields ?? {}
        if (res.error.code === "RATE_LIMITED") {
          setBanner(res.error.message)
        } else {
          // 服务端统一文案（不泄露账号是否存在）
          setBanner(res.error.message || "登录失败，请稍后重试")
          setFieldErrors({ username: errs.username, password: errs.password } as typeof fieldErrors)
        }
        return
      }
      const data = res.data as unknown as LoginSuccess
      toast.success("登录成功")
      const target = data.mustChangePassword
        ? `/admin/change-password${safeReturn ? `?returnTo=${encodeURIComponent(safeReturn)}` : ""}`
        : safeReturn || "/admin"
      // 整页替换：历史栈不保留登录表单（防"后退"回到敏感视图）
      window.location.replace(target)
    } catch {
      setBanner("网络异常，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-7 flex flex-col items-center text-center">
        <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-foreground">管理员登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">彩搜搜内容管理后台</p>
      </div>

      {banner ? (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
        >
          {banner}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <FormField id="admin-username" label="用户名" required error={fieldErrors.username} loading={loading} className="mb-4">
          <TextInput
            id="admin-username"
            type="text"
            autoComplete="username"
            maxLength={64}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入管理员用户名"
            leadingIcon={<ShieldCheck className="size-4" aria-hidden />}
          />
        </FormField>
        <FormField
          id="admin-password"
          label="密码"
          required
          error={fieldErrors.password}
          loading={loading}
          className="mb-5"
        >
          <TextInput
            id="admin-password"
            type={showPwd ? "text" : "password"}
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            trailing={
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
            }
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
              登录中…
            </>
          ) : (
            "登 录"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
        仅限授权管理员访问；连续失败将被临时限制
      </p>
    </div>
  )
}
