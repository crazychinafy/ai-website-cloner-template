'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BULLETINS } from '@/lib/facai8/data/bulletins'
import { fmtDateMD } from '@/lib/facai8/util'

// 顶部公告条（跑马灯：多条时 translateY 轮播）
export function Bulletins() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (BULLETINS.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % BULLETINS.length), 4000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="bulletins">
      <span className="bulletin-tag">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l14-6v14L3 13v-2z"></path>
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>
        </svg>
      </span>
      <span className="bulletin-label">公告</span>
      <div className="bulletin-marquee">
        <div className="bulletin-track" style={{ transform: `translateY(${-idx * 24}px)`, transition: 'transform .4s' }}>
          {BULLETINS.map((b) => (
            <Link key={b.id} className="bulletin-item" href={`/bulletin/${b.id}`}>
              <span className="bulletin-item-title">{b.title}</span>
              <span className="bulletin-date">{fmtDateMD(b.createdAt)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
