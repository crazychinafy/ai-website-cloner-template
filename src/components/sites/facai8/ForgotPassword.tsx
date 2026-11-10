'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from './Toast'
import { AuthBg, CaptchaRow, EMAIL_RE, EyeInput, PWD_MSG, PWD_RE, SMS_CODE_RE, useCaptcha, useCountdown } from './AuthWidgets'

// 源站 ForgotPassword chunk 1:1：三步流程（验证邮箱 → 重置密码 → 完成）+ 图片验证码 + 倒计时。
// Mock 差异：邮箱码不真实发送；无密码存储，校验通过即完成。

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

const STEPS = ['验证邮箱', '重置密码', '完成']

export function ForgotPassword() {
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [countdown, startCountdown] = useCountdown()
  const { captchaKey, captcha, setCaptcha, captchaUrl, refreshCaptcha } = useCaptcha()

  // 源站：启动遮罩移除
  useEffect(() => {
    const w = window as Window & { __hideBootLoader?: () => void }
    w.__hideBootLoader?.()
  }, [])

  const sendCode = async () => {
    if (!email || !EMAIL_RE.test(email)) return setErr('请输入正确的邮箱')
    if (!captcha.trim()) return setErr('请输入图片验证码')
    setSending(true)
    setErr('')
    try {
      const r = await callApi('/api/auth/forgot-password-code', { email, captchaKey, captcha: captcha.trim() })
      if (r.code === 200) {
        setStep(1)
        toast('验证码已发送', 'success')
        refreshCaptcha()
        setCaptcha('')
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

  const submit = async () => {
    setErr('')
    if (submitting) return
    if (!code.trim()) return setErr('请输入验证码')
    if (!SMS_CODE_RE.test(code.trim())) return setErr('验证码为6位数字')
    if (!PWD_RE.test(password)) return setErr(PWD_MSG)
    if (password !== password2) return setErr('两次密码不一致')
    if (!captcha.trim()) return setErr('请输入新的图片验证码')
    setSubmitting(true)
    try {
      const r = await callApi('/api/auth/reset-password', { email, code: code.trim(), password, captchaKey, captcha: captcha.trim() })
      if (r.code === 200) {
        setStep(2)
        toast('密码重置成功', 'success')
      } else {
        setErr(r.message)
        refreshCaptcha()
      }
    } catch {
      setErr('重置失败')
      refreshCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <AuthBg />
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-head-icon">🔑</div>
          <h2 className="auth-title">找回密码</h2>
          <p className="auth-subtitle">
            {step === 0 && '输入注册邮箱获取验证码'}
            {step === 1 && `验证码已发送至 ${email}`}
            {step === 2 && '密码已更新'}
          </p>
        </div>
        <div className="auth-steps">
          {STEPS.map((label, i) => (
            <div key={i} className={`auth-step ${step > i ? 'done' : ''} ${step === i ? 'current' : ''}`}>
              <span className="auth-step-dot">{step > i ? '✓' : i + 1}</span>
              <span className="auth-step-label">{label}</span>
            </div>
          ))}
        </div>
        {err && (
          <div className="auth-error">
            ⚠️ {err}
          </div>
        )}
        {step === 0 && (
          <>
            <div className="auth-code-row">
              <div className="auth-field" style={{ flex: 1, marginBottom: 0 }}>
                <span className="auth-field-icon">📧</span>
                <input type="email" placeholder="注册邮箱" value={email} maxLength={100} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <CaptchaRow value={captcha} onChange={setCaptcha} captchaUrl={captchaUrl} onRefresh={refreshCaptcha} />
            <button type="button" className="auth-btn" onClick={() => void sendCode()} disabled={sending || countdown > 0}>
              <span>{countdown > 0 ? `${countdown}s 后可重发` : sending ? '发送中' : '获取验证码'}</span>
            </button>
          </>
        )}
        {step === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="auth-field">
              <span className="auth-field-icon">🔢</span>
              <input type="text" placeholder="输入6位验证码" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="auth-field">
              <span className="auth-field-icon">🔒</span>
              <EyeInput placeholder="新密码 (8-50位，字母/数字/符号)" value={password} maxLength={50} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="auth-field">
              <span className="auth-field-icon">🔑</span>
              <EyeInput placeholder="确认新密码" value={password2} maxLength={50} onChange={(e) => setPassword2(e.target.value)} />
            </div>
            <CaptchaRow value={captcha} onChange={setCaptcha} captchaUrl={captchaUrl} onRefresh={refreshCaptcha} />
            <button type="submit" className="auth-btn" disabled={submitting}>
              <span>{submitting ? '重置中...' : '重置密码'}</span>
            </button>
          </form>
        )}
        {step === 2 && (
          <div className="auth-success">
            <div className="auth-success-icon">✅</div>
            <p className="auth-success-title">密码重置成功</p>
            <p className="auth-success-sub">请使用新密码登录</p>
          </div>
        )}
        <div className="auth-links">
          <Link href="/login" className="auth-link-strong">
            ← 返回登录
          </Link>
        </div>
      </div>
    </div>
  )
}
