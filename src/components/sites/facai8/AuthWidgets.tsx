'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CAPTCHA_RE, EMAIL_RE, PWD_MSG, PWD_RE, SMS_CODE_RE, USERNAME_RE } from '@/lib/facai8/auth-rules'

// 源站 auth 页共享件（1:1：xr AuthBg / wr 验证码 / Er 倒计时 / Sr 密码眼睛 / Tr 图片码行）

/** 源站 xr：24 个随机气泡 + 双层光晕。
 * 固定种子 PRNG（SSR/客户端确定性一致）：源站为纯客户端 SPA 每次挂载随机；本地 SSR 页面若用
 * Math.random() 会在 <Suspense> 边界内造成 hydration 不匹配 → React 延迟用新实例重挂载整棵子树
 * （验证码 key 重随机、已填输入被清空）。固定种子 = 单帧观感 1:1，跨刷新同构图（可接受，无人感知）。
 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeBubbles() {
  const rnd = mulberry32(20261109)
  return Array.from({ length: 24 }, () => ({
    left: rnd() * 96,
    size: 8 + rnd() * 30,
    duration: 8 + rnd() * 9,
    delay: -rnd() * 14,
    drift: (rnd() - 0.5) * 8,
  }))
}

export function AuthBg() {
  const bubs = useMemo(() => makeBubbles(), [])
  return (
    <div className="auth-bg">
      <div className="auth-haze auth-haze-1"></div>
      <div className="auth-haze auth-haze-2"></div>
      {bubs.map((b, i) => (
        <span
          key={i}
          className="auth-bub"
          style={
            {
              left: b.left + '%',
              width: b.size,
              height: b.size,
              animationDuration: b.duration + 's',
              animationDelay: b.delay + 's',
              '--bub-drift': b.drift + 'vw',
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** 源站 wr：图片验证码状态（key 挂载时随机；刷新 = 新时间戳 + 清空输入） */
export function useCaptcha() {
  const [captchaKey] = useState(() => Math.random().toString(36).slice(2))
  const [captcha, setCaptcha] = useState('')
  const [ts, setTs] = useState(() => Date.now())
  const refreshCaptcha = useCallback(() => {
    setTs(Date.now())
    setCaptcha('')
  }, [])
  return { captchaKey, captcha, setCaptcha, captchaUrl: `/api/auth/captcha?key=${captchaKey}&t=${ts}`, refreshCaptcha }
}

/** 源站 Er：秒级倒计时（start(n)；返回 [剩余秒, start]） */
export function useCountdown(): [number, (n: number) => void] {
  const [n, setN] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const start = useCallback((s: number) => {
    setN(s)
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => {
      setN((v) => {
        if (v <= 1) {
          if (timer.current) clearInterval(timer.current)
          timer.current = null
          return 0
        }
        return v - 1
      })
    }, 1000)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
    },
    []
  )
  return [n, start]
}

interface EyeInputProps {
  placeholder: string
  value: string
  maxLength: number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: () => void
  className?: string
  name?: string
  autoComplete?: string
}

/** 源站 Sr：密码输入 + 显隐眼睛（👁️/🙈） */
export function EyeInput({ placeholder, value, maxLength, onChange, onBlur, className }: EyeInputProps) {
  const [show, setShow] = useState(false)
  return (
    <>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="off"
        className={className ? `${className} has-eye` : 'has-eye'}
      />
      <button type="button" tabIndex={-1} className="auth-field-eye" onClick={() => setShow(!show)} title={show ? '隐藏密码' : '显示密码'}>
        {show ? '🙈' : '👁️'}
      </button>
    </>
  )
}

interface CaptchaRowProps {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  captchaUrl: string
  onRefresh: () => void
  rowStyle?: React.CSSProperties
  /** 源站 renderField：包裹外层（注册页用 auth-field-wrap + hint） */
  renderField?: (input: React.ReactNode) => React.ReactNode
}

/** 挂载前占位图（1×1 实色，CSS 放大为 96×47）：
 * 验证码 img 的 src 含随机 key + Date.now() 时间戳，SSR 与客户端不一致 → <Suspense> 边界内
 * hydration 不匹配 → React 延迟用新客户端实例替换整棵子树（验证码 key 重随机、已填输入被清空）。
 * 首帧渲染确定性占位图、挂载后换真实 URL → 零 hydration 差异。
 * （源站为纯客户端 SPA，fetch 完成前同样短暂空白，观感一致）
 */
const CAPTCHA_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP48OEnAAWtAtoLT2r/AAAAAElFTkSuQmCC'

/** 源站 Tr：图片验证码行（🛡️ 输入 + 可点击刷新图片） */
export function CaptchaRow({ value, onChange, onBlur, captchaUrl, onRefresh, rowStyle, renderField }: CaptchaRowProps) {
  // 挂载标志走 useSyncExternalStore（SSR/水合阶段 = 占位图，水合完成后 = 真实 URL）；
  // 不用 useState+effect（react-hooks/set-state-in-effect 禁止 effect 内同步 setState）
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const src = mounted ? captchaUrl : CAPTCHA_PLACEHOLDER
  const input = (
    <input
      type="text"
      placeholder="图片验证码 4位"
      value={value}
      maxLength={4}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  return (
    <div className="auth-code-row" style={rowStyle}>
      {renderField ? (
        renderField(input)
      ) : (
        <div className="auth-field" style={{ flex: 1, marginBottom: 0 }}>
          <span className="auth-field-icon">🛡️</span>
          {input}
        </div>
      )}
      <img src={src} alt="验证码" className="auth-captcha-img" onClick={onRefresh} title="点击刷新" />
    </div>
  )
}

export { CAPTCHA_RE, EMAIL_RE, PWD_MSG, PWD_RE, SMS_CODE_RE, USERNAME_RE }
