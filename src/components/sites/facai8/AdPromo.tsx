'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { AdDto } from '@/lib/facai8/content/types'
import { asset } from '@/lib/facai8/util'

// 广告推广区块（14 条横幅，点击头部折叠/展开）
// P8-4：广告列表由服务端（页面 → 仓库）注入。
export function AdPromo({ ads }: { ads: AdDto[] }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div
      className="home-banner-wrap"
      style={{ marginBottom: 28, background: 'rgb(250, 251, 252)', borderRadius: 14, border: '1px solid rgb(238, 240, 242)', overflow: 'hidden' }}
    >
      <div
        className="banner-header-bar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', cursor: 'pointer', userSelect: 'none', background: 'linear-gradient(90deg, rgb(248, 249, 252), rgb(255, 255, 255))', borderBottom: '1px solid rgb(238, 240, 242)' }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgb(81, 87, 103)' }}>📢</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'rgb(81, 87, 103)' }}>广告推广</span>
          <span style={{ fontSize: 11, color: 'rgb(194, 200, 209)', background: 'rgb(242, 243, 245)', padding: '2px 8px', borderRadius: 10 }}>
            {ads.length}条
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'rgb(176, 182, 192)', transition: 'transform 0.25s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
      </div>
      <div className="banner-list" style={{ padding: '12px 12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ads.map((ad) => (
          <Link
            key={ad.id}
            href={ad.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="home-banner-link"
            style={{ display: collapsed ? 'none' : 'block', borderRadius: 10, overflow: 'hidden', boxShadow: 'rgba(0, 0, 0, 0.04) 0px 1px 4px', border: '1px solid rgb(238, 240, 242)', transition: 'box-shadow 0.2s, transform 0.2s', textDecoration: 'none' }}
          >
            <img alt={ad.title} src={asset(ad.imageUrl) || ad.imageUrl} style={{ width: '100%', display: 'block', aspectRatio: '15 / 1' }} loading="lazy" />
          </Link>
        ))}
      </div>
    </div>
  )
}
