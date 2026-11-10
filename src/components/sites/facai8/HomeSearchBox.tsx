'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// 右栏站内搜索（源站：最多 10 字符，回车或点击 → /search?q=）
export function HomeSearchBox() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const go = () => {
    const s = q.trim()
    if (!s) return
    router.push('/search?q=' + encodeURIComponent(s))
  }
  return (
    <div className="home-search-box">
      <input
        placeholder="站内搜索..."
        maxLength={10}
        title="最多输入10个字符"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
        }}
      />
      <button onClick={go}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
        </svg>
      </button>
    </div>
  )
}
