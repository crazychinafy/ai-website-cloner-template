'use client'
import { useEffect, useState } from 'react'

// 全局轻提示（源站 toast 系统的本地等价：顶部居中、毛玻璃、2.6s 进度条、最多 3 条）
type ToastType = 'success' | 'error' | 'info'

interface Item {
  id: number
  msg: string
  type: ToastType
  leaving: boolean
}

type Listener = (msg: string, type?: ToastType) => void

const listeners = new Set<Listener>()
let nextId = 0

export function toast(msg: string, type: ToastType = 'info') {
  listeners.forEach((l) => l(msg, type))
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"></path>
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="m9 9 6 6M15 9l-6 6"></path>
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 11v5"></path>
      <path d="M12 8h.01"></path>
    </svg>
  ),
}

export function ToastHost() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    const l: Listener = (msg, type) => {
      const t: ToastType = type ?? 'info'
      const id = ++nextId
      setItems((cur) => [...cur.slice(-2), { id, msg, type: t, leaving: false }])
      setTimeout(() => {
        setItems((cur) => cur.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
        setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), 280)
      }, 2600)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  if (items.length === 0) return null
  return (
    <div className="toast-wrap">
      {items.map((x) => (
        <div key={x.id} className={`toast-item toast-${x.type}${x.leaving ? ' toast-leave' : ''}`} role="status">
          <span className="toast-ic">{ICONS[x.type]}</span>
          <span className="toast-msg">{x.msg}</span>
          <span className="toast-bar" style={{ animationDuration: '2600ms' }} />
        </div>
      ))}
    </div>
  )
}
