'use client'
import { useEffect, useMemo, useState } from 'react'

// 固定装饰背景：2 个光斑 + 15 个浮动气泡（源站每次加载随机生成参数）
interface Bub {
  left: string
  size: number
  dur: string
  delay: string
  drift: string
}

// mulberry32：确定性 PRNG，保证 SSR/水合一致
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

function makeBubs(seed: number): Bub[] {
  const rnd = mulberry32(seed)
  return Array.from({ length: 15 }, () => {
    const n = () => rnd()
    const between = (min: number, max: number) => min + n() * (max - min)
    return {
      left: between(0, 97).toFixed(4) + '%',
      size: Math.round(between(8, 34)),
      dur: between(8, 18).toFixed(3) + 's',
      delay: '-' + between(0, 14).toFixed(3) + 's',
      drift: between(-4, 4).toFixed(2) + 'vw',
    }
  })
}

export function SiteBg() {
  // 固定初始种子 → SSR 与客户端首次渲染一致（避免水合不匹配）
  const [seed, setSeed] = useState(20261108)
  const bubs = useMemo(() => makeBubs(seed), [seed])

  // 水合完成后换随机种子（源站每次加载即重新随机，视觉效果一致）
  useEffect(() => {
    const t = setTimeout(() => setSeed(Math.floor(Math.random() * 0x7fffffff)), 0)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="site-bg" aria-hidden="true">
      <i className="site-haze site-haze-1"></i>
      <i className="site-haze site-haze-2"></i>
      {bubs.map((b, i) => (
        <b
          key={i}
          className="site-bub"
          style={{
            left: b.left,
            width: b.size + 'px',
            height: b.size + 'px',
            animationDuration: b.dur,
            animationDelay: b.delay,
            ['--bub-drift' as string]: b.drift,
          }}
        ></b>
      ))}
    </div>
  )
}
