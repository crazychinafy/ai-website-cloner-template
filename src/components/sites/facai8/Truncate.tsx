'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// 源站 $ 组件（Truncate/Tooltip）：动态 tag；hover 且内容溢出（或 force）时 portal 浮层显示全文
interface TipState {
  left: number
  top?: number
  bottom?: number
  maxWidth: number
  maxHeight: number
  above: boolean
  anchorX: number
  arrowX: number
}

interface Props {
  tag?: ElementType
  text?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
  force?: boolean
}

export function Truncate({ tag: Tag = 'div', text, className = '', style, children, force = false }: Props) {
  const [tip, setTip] = useState<TipState | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const hide = useCallback(() => setTip(null), [])

  // 源站：浮层打开期间 scroll/resize → 关闭
  useEffect(() => {
    if (!tip) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [tip, hide])

  // 源站：箭头 x 收敛到浮层宽度内
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return
    const w = tipRef.current.offsetWidth
    const x = Math.round(Math.min(Math.max(tip.anchorX - tip.left, 14), Math.max(w - 14, 14)))
    if (x !== tip.arrowX) setTip((c) => (c ? { ...c, arrowX: x } : c))
  }, [tip])

  return (
    <Tag
      ref={elRef}
      className={className}
      style={style}
      onMouseEnter={() => {
        const el = elRef.current
        if (!el || !text) return
        if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return
        if (!(force || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) return
        const r = el.getBoundingClientRect()
        const spaceAbove = r.top - 20
        const spaceBelow = window.innerHeight - r.bottom - 20
        const above = spaceAbove >= 240 || spaceAbove >= spaceBelow
        const left = Math.max(8, Math.min(r.left, window.innerWidth - 356))
        setTip({
          left,
          maxWidth: Math.min(340, window.innerWidth - 24),
          maxHeight: Math.max(60, Math.min(above ? spaceAbove : spaceBelow, window.innerHeight - 40)),
          above,
          anchorX: r.left + r.width / 2,
          arrowX: Math.round(Math.min(Math.max(r.left + r.width / 2 - left, 14), 326)),
          ...(above ? { bottom: window.innerHeight - r.top + 10 } : { top: r.bottom + 10 }),
        })
      }}
      onMouseLeave={hide}
    >
      {children === undefined ? text : children}
      {tip &&
        createPortal(
          <div
            ref={tipRef}
            className={'hover-tip ' + (tip.above ? 'hover-tip--up' : 'hover-tip--down')}
            style={{
              left: tip.left,
              top: tip.top,
              bottom: tip.bottom,
              maxWidth: tip.maxWidth,
              ['--arrow-x' as string]: tip.arrowX + 'px',
            }}
          >
            <span style={{ display: 'block', maxHeight: tip.maxHeight, overflow: 'hidden' }}>{text}</span>
          </div>,
          document.body
        )}
    </Tag>
  )
}

/** 源站 g()：关键词命中处包 <mark class="srch-mark">（忽略大小写、正则转义），返回节点数组 */
export function hlNodes(text: string, kw: string): ReactNode[] {
  if (!kw || !text) return [text]
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re: RegExp
  try {
    re = new RegExp(`(${esc})`, 'gi')
  } catch {
    return [text]
  }
  return text.split(re).map((part, i) =>
    part.toLowerCase() === kw.toLowerCase() ? (
      <mark key={i} className="srch-mark">
        {part}
      </mark>
    ) : (
      part
    )
  )
}
