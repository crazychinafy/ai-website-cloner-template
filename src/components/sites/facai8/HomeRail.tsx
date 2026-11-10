import Link from 'next/link'
import { STATS } from '@/lib/facai8/data/stats'
import { NEW_LINKS } from '@/lib/facai8/data/new-links'
import { NEW_ARTICLES } from '@/lib/facai8/data/new-articles'
import { RECENT_LINKS } from '@/lib/facai8/data/recent-links'
import { asset, firstChar, fmtK, gstaticFavicon } from '@/lib/facai8/util'
import { HomeSearchBox } from './HomeSearchBox'
import { ContactsWidget } from './ContactsWidget'

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
)

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="home-stats" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#333333' }}>{title}</span>
        <button type="button" title="刷新" className="refresh-btn">
          <RefreshIcon />
        </button>
      </div>
      {children}
    </div>
  )
}

// 首页右栏（240px）：搜索 / 统计 / 线路检测 / 联系我们 / 最新收录 / 最新文章 / 最近更新
export function HomeRail() {
  const tiles = [
    { icon: '🌐', num: fmtK(STATS.links), label: '收录网址', sc: '#1e80ff', bg: 'rgb(232, 243, 255)' },
    { icon: '📝', num: fmtK(STATS.articles), label: '收录文章', sc: '#2f8bff', bg: 'rgb(234, 244, 255)' },
    { icon: '💬', num: fmtK(STATS.comments), label: '评论总数', sc: '#f59e0b', bg: 'rgb(255, 251, 235)' },
    { icon: '👁️', num: fmtK(STATS.totalViews), label: '总浏览', sc: '#10b981', bg: 'rgb(236, 253, 245)' },
  ]
  return (
    <aside className="home-sidebar">
      <HomeSearchBox />

      <div className="home-stats">
        <div className="stats-grid">
          {tiles.map((t) => (
            <div key={t.label} className="stat-tile" style={{ ['--sc' as string]: t.sc, background: t.bg }}>
              <span className="stat-tile-icon">{t.icon}</span>
              <div className="stat-tile-info">
                <span className="stat-tile-num">{t.num}</span>
                <span className="stat-tile-label">{t.label}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="stats-actions">
          <Link className="stat-btn submit" href="/submit-article?tab=link">📮 申请收录</Link>
          <Link className="stat-btn write" href="/submit-article?tab=article">✍️ 发布文章</Link>
        </div>
      </div>

      <Link className="widget-card widget-lines" href="/lines" style={{ display: 'block', textDecoration: 'none' }}>
        <div className="widget-head">
          <span className="widget-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M2 12h20"></path>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </span>
          <span className="widget-texts">
            <span className="widget-title">线路检测</span>
            <span className="widget-sub">多线路实时测速</span>
          </span>
          <span className="widget-live" title="服务在线"></span>
          <svg className="widget-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </div>
      </Link>

      <ContactsWidget />

      <RailCard title="🆕 最新收录">
        <div className="refreshing-list new-links-list">
          {NEW_LINKS.map((l) => (
            <Link key={l.id} href={`/link/${l.id}`} target="_blank" rel="noreferrer" className="recent-item">
              <span className="recent-dot"></span>
              <span className="side-logo-wrap">
                <span className="side-logo-fallback" aria-hidden="true">{firstChar(l.title)}</span>
                <img alt="" loading="lazy" decoding="async" src={l.logoUrl ? asset(l.logoUrl) || '' : gstaticFavicon(l.url)} />
              </span>
              <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{l.title}</span>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: '#8a919f' }}>{l.categoryName}</span>
              </span>
              <span className="new-tag">NEW</span>
            </Link>
          ))}
        </div>
      </RailCard>

      <RailCard title="📰 最新文章">
        <div className="refreshing-list">
          {NEW_ARTICLES.map((a) => (
            <Link key={a.id} href={`/articles/${a.id}`} className="recent-item">
              <span className="recent-dot"></span>
              <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{a.title}</span>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: '#8a919f' }}>{a.categoryName}</span>
              </span>
            </Link>
          ))}
        </div>
      </RailCard>

      <RailCard title="🕐 最近更新">
        <div className="refreshing-list recent-links-list">
          {RECENT_LINKS.map((l) => (
            <Link key={l.id} href={`/link/${l.id}`} target="_blank" rel="noreferrer" className="recent-item">
              <span className="recent-dot"></span>
              <span className="side-logo-wrap">
                <span className="side-logo-fallback" aria-hidden="true">{firstChar(l.title)}</span>
                <img alt="" loading="lazy" decoding="async" src={l.logoUrl ? asset(l.logoUrl) || '' : gstaticFavicon(l.url)} />
              </span>
              <span style={{ flex: '1 1 0%', minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{l.title}</span>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: '#8a919f' }}>{l.categoryName}</span>
              </span>
            </Link>
          ))}
        </div>
      </RailCard>
    </aside>
  )
}
