'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from './Toast'
import { AuthBg, CAPTCHA_RE, CaptchaRow, useCaptcha, useCountdown, EyeInput } from './AuthWidgets'

// 源站 Lr（登录页）1:1：双标签（密码/验证码）+ 图片验证码 + 锁定态 + 倒计时。
// 差异（任务书要求）：源站 localStorage token；本地 = HttpOnly cookie，登录成功做整页导航（等价源站 replace+reload）。

function normalizeRedirect(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/'
}

async function callApi(path: string, payload: Record<string, unknown>): Promise<{ code: number; message: string; data: Record<string, unknown> }> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const o = (await r.json()) as { code: number; message?: string; data?: Record<string, unknown> }
    return { code: o.code, message: o.message || '操作失败', data: o.data || {} }
  } catch {
    return { code: 500, message: '网络错误，请重试', data: {} }
  }
}

export function Login() {
  const sp = useSearchParams()
  const redirect = normalizeRedirect(sp.get('redirect'))
  const [tab, setTab] = useState<'password' | 'code'>('password')
  const [form, setForm] = useState({ username: '', password: '', email: '' })
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [locked, setLocked] = useState(false)
  const [countdown, startCountdown] = useCountdown()
  const { captchaKey, captcha, setCaptcha, captchaUrl, refreshCaptcha } = useCaptcha()

  // 源站：启动遮罩移除 + 退出登录提示（已退出登录 → 绿色 toast；其余 → 红色提示条）
  useEffect(() => {
    const w = window as Window & { __hideBootLoader?: () => void }
    w.__hideBootLoader?.()
    const n = sessionStorage.getItem('login_notice')
    if (n) {
      sessionStorage.removeItem('login_notice')
      if (n === '已退出登录') toast(n, 'success')
      else setErr(n)
    }
  }, [])

  const succeed = () => {
    // 源站：router.replace(redirect) + window.location.reload()；本地整页导航等价
    window.location.href = redirect
  }

  const submitPassword = async () => {
    setErr('')
    if (locked) return
    if (!form.username.trim() || !form.password) return setErr('请输入用户名和密码')
    if (!captcha.trim()) return setErr('请输入验证码')
    if (!CAPTCHA_RE.test(captcha.trim())) return setErr('验证码格式不正确')
    setSubmitting(true)
    try {
      const r = await callApi('/api/auth/login', {
        username: form.username,
        password: form.password,
        captchaKey,
        captcha: captcha.trim(),
      })
      if (r.code === 200) return succeed()
      setErr(r.message)
      if ((r.message || '').includes('已锁定')) setLocked(true)
      refreshCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  const submitCode = async () => {
    setErr('')
    if (submitting) return
    if (!code.trim()) return setErr('请输入验证码')
    if (!/^\d{6}$/.test(code.trim())) return setErr('验证码为6位数字')
    if (!captcha.trim()) return setErr('请输入图片验证码')
    if (!CAPTCHA_RE.test(captcha.trim())) return setErr('验证码格式不正确')
    setSubmitting(true)
    try {
      const r = await callApi('/api/auth/login-by-code', {
        email: form.email,
        code: code.trim(),
        captchaKey,
        captcha: captcha.trim(),
      })
      if (r.code === 200) return succeed()
      setErr(r.message)
      if ((r.message || '').includes('已锁定')) setLocked(true)
      refreshCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  const sendLoginCode = async () => {
    if (!form.email || !/^[\w.-]+@[\w.-]+\.\w+$/.test(form.email)) return setErr('请输入正确邮箱')
    if (!captcha.trim()) return setErr('请输入图片验证码')
    if (!CAPTCHA_RE.test(captcha.trim())) return setErr('验证码格式不正确')
    setSending(true)
    setErr('')
    try {
      const r = await callApi('/api/auth/send-login-code', { email: form.email, captchaKey, captcha: captcha.trim() })
      if (r.code === 200) {
        toast('验证码已发送', 'success')
        refreshCaptcha()
        startCountdown(60)
      } else {
        const m = (r.message || '').match(/(\d+)秒后重试/)
        if (m) {
          startCountdown(parseInt(m[1], 10))
          toast(r.message, 'error')
        } else {
          setErr(r.message)
          if ((r.message || '').includes('验证码')) refreshCaptcha()
        }
      }
    } catch {
      setErr('发送失败')
    } finally {
      setSending(false)
    }
  }

  const switchTab = (t: 'password' | 'code') => {
    setTab(t)
    setErr('')
    setLocked(false)
  }

  return (
    <div className="auth-page">
      <AuthBg />
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-head-icon">🗺️</div>
          <h2 className="auth-title">欢迎回来</h2>
          <p className="auth-subtitle">登录后继续你的导航之旅</p>
        </div>
        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${tab === 'password' ? 'active' : ''}`} onClick={() => switchTab('password')}>
            🔑 密码登录
          </button>
          <button type="button" className={`auth-tab ${tab === 'code' ? 'active' : ''}`} onClick={() => switchTab('code')}>
            📧 验证码登录
          </button>
        </div>
        {err && (
          <div className="auth-error">
            ⚠️ {err}
          </div>
        )}
        {tab === 'password' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitPassword()
            }}
          >
            <div className="auth-field">
              <span className="auth-field-icon">👤</span>
              <input
                type="text"
                placeholder="用户名"
                value={form.username}
                maxLength={20}
                autoComplete="off"
                onChange={(e) => {
                  setForm({ ...form, username: e.target.value })
                  setLocked(false)
                }}
              />
            </div>
            <div className="auth-field">
              <span className="auth-field-icon">🔒</span>
              <EyeInput
                placeholder="密码"
                value={form.password}
                maxLength={50}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <CaptchaRow value={captcha} onChange={setCaptcha} captchaUrl={captchaUrl} onRefresh={refreshCaptcha} />
            <button type="submit" className="auth-btn" disabled={locked || submitting}>
              <span>{locked ? '已锁定，请30分钟后重试' : submitting ? '登录中...' : '登 录'}</span>
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitCode()
            }}
          >
            <div className="auth-code-row">
              <div className="auth-field" style={{ flex: 1, marginBottom: 0 }}>
                <span className="auth-field-icon">📧</span>
                <input
                  type="email"
                  placeholder="邮箱"
                  value={form.email}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => {
                    setForm({ ...form, email: e.target.value })
                    setLocked(false)
                  }}
                />
              </div>
            </div>
            <CaptchaRow value={captcha} onChange={setCaptcha} captchaUrl={captchaUrl} onRefresh={refreshCaptcha} />
            <div className="auth-field">
              <span className="auth-field-icon">🔢</span>
              <input type="text" placeholder="输入6位验证码" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} />
            </div>
            <button
              type="button"
              className="auth-code-btn"
              onClick={() => void sendLoginCode()}
              disabled={sending || countdown > 0}
              style={{ width: '100%', marginBottom: 12 }}
            >
              {countdown > 0 ? `${countdown}s 后可重发` : sending ? '发送中' : '发送验证码'}
            </button>
            <button type="submit" className="auth-btn" disabled={locked || submitting}>
              <span>{locked ? '已锁定，请30分钟后重试' : submitting ? '登录中...' : '登 录'}</span>
            </button>
          </form>
        )}
        <div className="auth-links">
          没有账号？
          <Link href="/register" className="auth-link-strong">
            立即注册
          </Link>
          <span className="auth-links-sep">|</span>
          <Link href="/forgot-password">忘记密码</Link>
        </div>
      </div>
    </div>
  )
}
