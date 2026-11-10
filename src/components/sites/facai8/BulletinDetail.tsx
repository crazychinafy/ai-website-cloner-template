import Link from 'next/link'
import { BULLETINS, type Bulletin } from '@/lib/facai8/data/bulletins'
import { localHtml } from '@/lib/facai8/util'

// 源站详情响应字段（x-bulletin-detail.json 存档）：prevId / nextId / listPage
interface Props {
  bulletin: Bulletin
  total: number
  prevId: string | null
  nextId: string | null
}

/** 源站 v(createdAt)：侧栏日期 `9-14`（月-日，日补零；直接取字符串分量，避免时区漂移） */
function sideDate(s: string): string {
  const d = s.split('T')[0]
  if (!d) return ''
  const [y, m, day] = d.split('-').map((x) => parseInt(x, 10))
  if (isNaN(y) || isNaN(m) || isNaN(day)) return ''
  return `${m}-${String(day).padStart(2, '0')}`
}

/** 源站 head 日期：`2026年9月14日 21:54`（toLocaleDateString/Time zh-CN 的等值字符串解析） */
function headDate(s: string): string {
  const [d, time] = s.split('T')
  const [y, m, day] = (d || '').split('-').map((x) => parseInt(x, 10))
  if (isNaN(y) || isNaN(m) || isNaN(day)) return ''
  const [hh, mm] = (time || '').split(':')
  return `${y}年${m}月${day}日 ${hh || '00'}:${mm || '00'}`
}

// 公告详情（源站懒加载 chunk BulletinDetail 的本地等价；本地数据静态，无加载态）
export function BulletinDetail({ bulletin, total, prevId, nextId }: Props) {
  const id = bulletin.id
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '30px 20px' }}>
      <div className="bulletin-layout">
        <div className="bulletin-main">
          <div
            className="flip-fill"
            style={{
              position: 'relative',
              background: '#fff',
              borderRadius: 16,
              padding: 'clamp(20px,5vw,40px) clamp(20px,5vw,48px)',
              boxShadow: '0 2px 8px rgba(0,0,0,.04)',
              border: '1px solid #f0f0f0',
            }}
          >
            <div className="bulletin-head">
              <span className="bulletin-head-tag">📢 公告</span>
              <h1 className="detail-title-clamp bulletin-title">{bulletin.title}</h1>
              <div className="bulletin-head-date">🕒 {headDate(bulletin.createdAt)}</div>
            </div>
            <div>
              <div
                className="article-detail-content"
                style={{ lineHeight: 1.9, fontSize: 15, color: '#374151', wordBreak: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: localHtml(bulletin.content || '') }}
              />
            </div>
            {(prevId || nextId) && (
              <div className="bulletin-nav-cards">
                {prevId ? (
                  <Link href={`/bulletin/${prevId}`} className="bulletin-nav-card">
                    <span className="bnc-label">← 上一篇</span>
                  </Link>
                ) : (
                  <span className="bnc-empty" />
                )}
                {nextId ? (
                  <Link href={`/bulletin/${nextId}`} className="bulletin-nav-card next">
                    <span className="bnc-label">下一篇 →</span>
                  </Link>
                ) : (
                  <span className="bnc-empty" />
                )}
              </div>
            )}
          </div>
        </div>
        <div className="bulletin-sidebar" style={{ position: 'sticky', top: 72 }}>
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '20px',
              border: '1px solid #f0f0f0',
              boxShadow: '0 2px 8px rgba(0,0,0,.04)',
            }}
          >
            <div className="bulletin-side-head">
              <span className="bulletin-side-icon">📋</span>
              <span className="bulletin-side-title">公告列表</span>
              <span className="bulletin-side-count">共 {total} 条</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: 1, transition: 'opacity .15s' }}>
              {BULLETINS.map((e) => {
                const active = String(e.id) === id
                return (
                  <Link
                    key={e.id}
                    href={`/bulletin/${e.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 12px',
                      borderRadius: 8,
                      fontSize: 13,
                      color: active ? '#1e80ff' : '#5f6b7a',
                      fontWeight: active ? 600 : 400,
                      background: active ? 'linear-gradient(135deg, #f0f7ff, #e6f1fe)' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all .15s',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#5ea8ff' : '#c2c8d1', flexShrink: 0 }} />
                    <span style={{ flex: '1 1 0%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.title}
                    </span>
                    <span className="bulletin-side-date" style={active ? { color: '#8b93f8' } : undefined}>
                      {sideDate(e.createdAt)}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
