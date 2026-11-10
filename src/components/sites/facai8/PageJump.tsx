'use client'
import { useState } from 'react'

// 源站 PageJump 组件 1:1：页码输入（仅数字）+ 跳转按钮。
// onGo 接收 0 基页码（源站 `Math.min(Math.max(1, r), max) - 1`）；busy 或空输入时按钮禁用。
export function PageJump({
  max,
  busy = false,
  onGo,
  btnClass = 'pager-btn',
}: {
  max: number
  busy?: boolean
  onGo: (page: number) => void
  btnClass?: string
}) {
  const [val, setVal] = useState('')
  const go = () => {
    const r = parseInt(val, 10)
    setVal('')
    if (!(Number.isNaN(r) || busy)) onGo(Math.min(Math.max(1, r), max) - 1)
  }
  return (
    <span className="page-jump">
      <input
        className="page-jump-input"
        value={val}
        inputMode="numeric"
        placeholder="页码"
        aria-label="跳转页码"
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
        }}
      />
      <button type="button" className={btnClass} disabled={busy || !val} onClick={go}>
        跳转
      </button>
    </span>
  )
}
