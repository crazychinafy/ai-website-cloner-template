'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from './Toast'
import { AuthBg, CAPTCHA_RE, CaptchaRow, EMAIL_RE, EyeInput, PWD_MSG, PWD_RE, SMS_CODE_RE, useCaptcha, useCountdown, USERNAME_RE } from './AuthWidgets'

// 源站 Register chunk 1:1：字段级实时校验（blur 后出 hint/invalid）+ 邮箱发码 + 图片码。
// Mock 差异：注册不落盘（本地无用户存储），校验通过即成功并跳登录页；邮箱码不真实发送。

type Field = 'email' | 'username' | 'password' | 'password2' | 'code' | 'captcha'
interface Form {
  username: string
  password: string
  password2: string
  email: string
}

const Y: Record<Field, (v: string, f?: Form) => string> = {
  email: (v) => (v ? (EMAIL_RE.test(v) ? '' : '邮箱格式不正确') : ' '),
  username: (v) => (v ? (USERNAME_RE.test(v) ? '' : '5-20位小写字母，可含数字') : ' '),
  password: (v) => (v ? (PWD_RE.test(v) ? '' : PWD_MSG) : ' '),
  password2: (v, f) => (v ? (v === f?.password ? '' : '两次密码不一致') : ' '),
  code: (v) => (v ? (SMS_CODE_RE.test(v) ? '' : '6位数字验证码') : ' '),
  captcha: (v) => (v ? (CAPTCHA_RE.test(v) ? '' : '4位字母或数字验证码') : ' '),
}
const ICONS: Record<Field, string> = { email: '📧', username: '👤', password: '🔒', password2: '🔑', code: '🔢', captcha: '🛡️' }

export function Register() {
  const router = useRouter()
  const [form, setForm] = useState<Form>({ username: '', password: '', password2: '', email: '' })
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [gotCode, setGotCode] = useState(false)
  const [countdown, startCountdown] = useCountdown()
  const { captchaKey, captcha, setCaptcha, captchaUrl, refreshCaptcha } = useCaptcha()
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [hints, setHints] = useState<Partial<Record<Field, string>>>({})

  // 源站：启动遮罩移除
  useEffect(() => {
    const w = window as Window & { __hideBootLoader?: () => void }
    w.__hideBootLoader?.()
  }, [])

  const revalidate = (field: Field, formNow: Form) =>
    setHints((h) => ({ ...h, [field]: Y[field](field === 'password2' ? formNow.password2 : formNow[field as keyof Form] || '', formNow) }))

  const change = (field: Field, v: string) => {
    const f = { ...form, [field]: v }
    setForm(f)
    if (touched[field]) revalidate(field, f)
  }
  const blur = (field: Field) => {
    setTouched((t) => ({ ...t, [field]: true }))
    setHints((h) => ({ ...h, [field]: Y[field](field === 'password2' ? form.password2 : form[field as keyof Form] || '', form) }))
  }
  const hint = (field: Field) => {
    const h = hints[field]
    return h && h !== ' ' ? h : null
  }

  const sendCode = async () => {
    if (!form.email || !EMAIL_RE.test(form.email)) return setErr('请输入正确的邮箱地址')
    if (!captcha.trim()) return setErr('请输入图片验证码')
    setSending(true)
    setErr('')
    try {
      const r = await callApi('/api/auth/send-register-code', { email: form.email, captchaKey, captcha: captcha.trim() })
      if (r.code === 200) {
        setGotCode(true)
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
    const msgs: string[] = []
    for (const f of Object.keys(Y) as Field[]) {
      const m = Y[f](f === 'password2' ? form.password2 : form[f as keyof Form] || '', form)
      if (m && m !== ' ') msgs.push(m)
    }
    if (msgs.length > 0) return setErr(msgs[0])
    if (!gotCode) return setErr('请先获取邮箱验证码')
    if (!captcha.trim()) return setErr('请输入新的图片验证码（发码后图片已刷新）')
    setSubmitting(true)
    try {
      const r = await callApi('/api/auth/register', {
        username: form.username,
        password: form.password,
        email: form.email,
        code: code.trim(),
        captchaKey,
        captcha: captcha.trim(),
      })
      if (r.code === 200) {
        toast('注册成功，请登录', 'success')
        router.push('/login')
      } else {
        setErr(r.message)
        refreshCaptcha()
      }
    } catch {
      setErr('注册失败')
      refreshCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  const wrap = (field: Field, input: React.ReactNode, key?: string) => (
    <div className={`auth-field-wrap ${hint(field) ? 'has-hint' : ''}`} key={key ?? field}>
      <div className={`auth-field ${hint(field) ? 'invalid' : ''}`} style={{ marginBottom: 0 }}>
        <span className="auth-field-icon">{ICONS[field]}</span>
        {input}
      </div>
      {hint(field) && <div className="auth-hint">{hint(field)}</div>}
    </div>
  )

  const g = (field: 'username' | 'password' | 'password2', props: { placeholder: string; maxLength: number; secret?: boolean }) => {
    const { secret, ...rest } = props
    return wrap(
      field,
      secret ? (
        <EyeInput placeholder={props.placeholder} value={form[field as keyof Form] as string} maxLength={props.maxLength} onChange={(e) => change(field, e.target.value)} onBlur={() => blur(field)} />
      ) : (
        <input type="text" {...rest} value={form[field as keyof Form] as string} onBlur={() => blur(field)} onChange={(e) => change(field, e.target.value)} />
      )
    )
  }

  return (
    <div className="auth-page">
      <AuthBg />
      <form
        className="auth-card"
        style={{ width: 440 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="auth-head">
          <div className="auth-head-icon">✨</div>
          <h2 className="auth-title">创建账号</h2>
          <p className="auth-subtitle">加入我们，发现更多精彩</p>
        </div>
        {err && (
          <div className="auth-error">
            ⚠️ {err}
          </div>
        )}
        <div className="auth-code-row" style={{ marginBottom: 0, alignItems: 'flex-start' }}>
          {wrap(
            'email',
            <input type="email" placeholder="邮箱" value={form.email} maxLength={100} autoComplete="off" onChange={(e) => { change('email', e.target.value); setGotCode(false) }} onBlur={() => blur('email')} />
          )}
          <button type="button" className="auth-code-btn" onClick={() => void sendCode()} disabled={sending || countdown > 0}>
            {countdown > 0 ? `${countdown}s` : sending ? '发送中' : gotCode ? '重发' : '发送验证码'}
          </button>
        </div>
        {wrap(
          'code',
          <input
            type="text"
            placeholder="输入6位邮箱验证码"
            value={code}
            maxLength={6}
            onBlur={() => blur('code')}
            onChange={(e) => {
              setCode(e.target.value)
              setErr('')
              if (touched.code) setHints((h) => ({ ...h, code: Y.code(e.target.value) }))
            }}
          />
        )}
        {g('username', { placeholder: '用户名 5-20位小写字母，可含数字', maxLength: 20 })}
        {g('password', { secret: true, placeholder: '密码 8-50位，字母/数字/符号', maxLength: 50 })}
        {g('password2', { secret: true, placeholder: '确认密码', maxLength: 50 })}
        <CaptchaRow
          value={captcha}
          onChange={(v) => {
            setCaptcha(v)
            if (touched.captcha) setHints((h) => ({ ...h, captcha: Y.captcha(v) }))
          }}
          onBlur={() => blur('captcha')}
          captchaUrl={captchaUrl}
          onRefresh={refreshCaptcha}
          rowStyle={{ marginBottom: 0, alignItems: 'flex-start' }}
          renderField={(input) => wrap('captcha', input)}
        />
        <button type="submit" className="auth-btn" style={{ marginTop: 4 }} disabled={submitting}>
          <span>{submitting ? '创建中...' : '创建账号'}</span>
        </button>
        <div className="auth-links">
          已有账号？
          <Link href="/login" className="auth-link-strong">
            去登录
          </Link>
        </div>
      </form>
    </div>
  )
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
