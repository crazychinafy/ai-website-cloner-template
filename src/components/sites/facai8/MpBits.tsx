import type { ReactNode } from 'react'
import Link from 'next/link'
import { fmtK } from '@/lib/facai8/util'

// 源站收藏/评论/发布三页共享的 hero + 空态（`mp-hero` / `mp-empty`）1:1 片段。

export function MpHero({
  title,
  sub,
  count,
  countSuffix,
  tabs,
}: {
  title: string // 含图标，如「⭐ 我的收藏」
  sub: ReactNode
  count: number
  countSuffix: string // 如「个收藏」/「条评论」/「条网址」
  tabs?: ReactNode
}) {
  return (
    <div className="mp-hero">
      <div className="mp-hero-top">
        <div>
          <h2 className="mp-hero-title">{title}</h2>
          <p className="mp-hero-sub">{sub}</p>
        </div>
        <div className="mp-hero-count">
          <b>{fmtK(count)}</b>
          <span>{countSuffix}</span>
        </div>
      </div>
      {tabs}
    </div>
  )
}

/** 网址/文章 双分段（收藏 + 发布页用） */
export function MpTabs({ tab, onTab }: { tab: 'links' | 'articles'; onTab: (t: 'links' | 'articles') => void }) {
  return (
    <div className="mp-tabs">
      <button type="button" className={`mp-tab ${tab === 'links' ? 'active' : ''}`} onClick={() => onTab('links')}>
        🌐 网址
      </button>
      <button type="button" className={`mp-tab ${tab === 'articles' ? 'active' : ''}`} onClick={() => onTab('articles')}>
        📄 文章
      </button>
    </div>
  )
}

/** 状态过滤条（评论 + 发布页用） */
export function MpFilters({
  filters,
  active,
  onFilter,
}: {
  filters: { k: string; v: string }[]
  active: string
  onFilter: (k: string) => void
}) {
  return (
    <div className="mp-filters">
      {filters.map((f) => (
        <button key={f.k} type="button" className={`mp-filter ${active === f.k ? 'active' : ''}`} onClick={() => onFilter(f.k)}>
          {f.v}
        </button>
      ))}
    </div>
  )
}

export function MpEmpty({
  icon,
  title,
  sub,
  to,
  linkLabel,
}: {
  icon: string
  title: string
  sub: string
  to: string
  linkLabel: string
}) {
  return (
    <div className="mp-empty">
      <div className="mp-empty-icon">{icon}</div>
      <div className="mp-empty-title">{title}</div>
      <div className="mp-empty-sub">{sub}</div>
      <Link href={to} className="mp-empty-link">
        {linkLabel}
      </Link>
    </div>
  )
}
