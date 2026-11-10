'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Article } from '@/lib/facai8/data/articles'
import type { LinkItem } from '@/lib/facai8/data/links'
import type { Ad } from '@/lib/facai8/data/ads'
import type { LinkDetailExtra } from '@/lib/facai8/data/link-details'
import type { LinkMirror } from '@/lib/facai8/data/link-mirrors'
import type { SessionUser } from '@/lib/facai8/auth'
import { asset, displayUrl, fmtDate, fmtK, gstaticFavicon, localHtml, tagById } from '@/lib/facai8/util'
import { toast } from '@/components/sites/facai8/Toast'

// 探测状态：null=检测中(灰/琥珀) ok=绿 fail=红
type PingState = 'ok' | 'fail' | null

interface Props {
  link: LinkItem
  extra: LinkDetailExtra
  mirrors: LinkMirror[]
  related: Article[]
  ads: Ad[]
  user: SessionUser | null
}

// no-cors 探测（源站同款：12s 超时；可解析=ok，网络失败=fail）
function ping(url: string, onDone: (s: 'ok' | 'fail') => void) {
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), 12000)
  fetch(url, { mode: 'no-cors', signal: ac.signal })
    .then(() => onDone('ok'))
    .catch(() => onDone('fail'))
    .finally(() => clearTimeout(to))
}

const DOT_COLOR: Record<string, string> = { ok: '#22c55e', fail: '#ef4444', null: '#8a919f' }
const dotClass = (s: PingState) => (s === 'ok' ? 'dot-ok' : s === 'fail' ? 'dot-fail' : 'dot-checking')

// 反馈类型（源站 /api 反馈类型表的本地存档）
const FB_TYPES = [
  { id: '1', name: '链接失效' },
  { id: '2', name: '网站名称不符' },
  { id: '3', name: '已换系统' },
]

// 站点详情：预览图(lightbox) + link-head + 评论/相关文章侧栏 + 访问链接/备用链接/广告/详情介绍
export function LinkDetail({ link, extra, mirrors, related, ads, user }: Props) {
  const router = useRouter()
  const wide = related.length > 0
  const isGone = link.isGone === 1
  const tag = tagById(link.tagId)

  const [clicks, setClicks] = useState(parseInt(extra.clickCount, 10) || 0)
  const [likes, setLikes] = useState(parseInt(extra.likeCount, 10) || 0)
  const [liked, setLiked] = useState(false)
  const [mainStatus, setMainStatus] = useState<PingState>(null)
  const [mirrorStatus, setMirrorStatus] = useState<Record<string, 'ok' | 'fail'>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [fbOpen, setFbOpen] = useState(false)
  const [fbSel, setFbSel] = useState<string | null>(null)
  const [fbPending, setFbPending] = useState(false)
  const [fbBusy, setFbBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [lbSrc, setLbSrc] = useState<string | null>(null)
  const [lbScale, setLbScale] = useState(1)
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 })
  const [lbDrag, setLbDrag] = useState(false)
  const [showBox, setShowBox] = useState(true)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const visitedRef = useRef('')
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panRef = useRef({ x: 0, y: 0, px: 0, py: 0 })

  // 数据加载后：主链接 + 每个备用域名并行探测；首次进入浏览量 +1（源站行为）
  useEffect(() => {
    ping(link.url, (s) => setMainStatus(s))
    for (const m of mirrors) ping(m.url, (s) => setMirrorStatus((cur) => ({ ...cur, [m.id]: s })))
    if (visitedRef.current !== link.id) {
      visitedRef.current = link.id
      setClicks((c) => c + 1)
    }
    // 预览图预加载（800ms 竞速；失败隐藏卡片）
    const src = extra.previewImage ? asset(extra.previewImage) : null
    if (!src) {
      setPreview(null)
      return
    }
    let alive = true
    let done = false
    const img = new Image()
    img.onload = () => {
      done = true
      if (alive) setPreview(src)
    }
    img.onerror = () => {
      done = true
      if (alive) setPreview(null)
    }
    img.src = src
    const to = setTimeout(() => {
      if (!done && alive) setPreview(src)
    }, 800)
    return () => {
      alive = false
      clearTimeout(to)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.id])

  // 复制态 1.5s 后复位（源站 Yn=1500）
  useEffect(() => {
    if (!copied) return
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 1500)
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [copied])

  const title = link.title
  const description = link.description
  const annotation = extra.annotation
  const logoSrc = extra.logoUrl || link.logoUrl ? asset(extra.logoUrl || link.logoUrl) || gstaticFavicon(link.url) : gstaticFavicon(link.url)
  const display = displayUrl(link.url)

  const onLike = () => {
    if (!user) {
      toast('请先登录', 'error')
      router.push('/login?redirect=' + encodeURIComponent(`/link/${link.id}`))
      return
    }
    setLiked((v) => {
      setLikes((n) => Math.max(0, n + (v ? -1 : 1)))
      toast(v ? '已取消收藏' : '已收藏', 'success')
      return !v
    })
  }

  const onCopy = (e: React.MouseEvent, key: string, url: string) => {
    e.preventDefault()
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* noop */
      }
      document.body.removeChild(ta)
    }
    navigator.clipboard
      ?.writeText(url)
      .catch(fallback)
      .finally(() => setCopied(key))
  }

  const submitFb = async () => {
    if (!fbSel) {
      toast('请选择反馈类型', 'error')
      return
    }
    if (!user) {
      toast('请先登录', 'error')
      router.push('/login?redirect=' + encodeURIComponent(`/link/${link.id}`))
      return
    }
    setFbBusy(true)
    // Mock：本地不持久化反馈，仅演示交互流程（源站 POST /api/links/{id}/feedback → pending）
    setTimeout(() => {
      setFbBusy(false)
      setFbPending(true)
      setFbOpen(false)
      setFbSel(null)
      toast('反馈已提交，感谢反馈', 'success')
    }, 600)
  }

  const closeLb = () => {
    setLbSrc(null)
    setLbScale(1)
    setLbPan({ x: 0, y: 0 })
  }

  const post = () => {
    if (!draft.trim() || posting) return
    setPosting(true)
    // Mock：本地不持久化评论（源站：提交后进入审核中列表）
    setTimeout(() => {
      setPosting(false)
      setDraft('')
      setShowBox(false)
    }, 600)
  }

  const visitDotStyle = (s: PingState): CSSProperties => {
    const c = DOT_COLOR[s === null ? 'null' : s]
    return {
      width: 8,
      height: 8,
      borderRadius: '50%',
      display: 'inline-block',
      marginRight: 6,
      background: c,
      ['--dot-c' as string]: c,
      animation: s ? 'none' : 'pulse-dot .8s ease-in-out infinite',
    } as CSSProperties
  }

  return (
    <div className={'container detail-page' + (wide ? ' detail-page-wide' : '')}>
      <div className="detail-body">
        <div style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="detail-main-top">
            <div className="detail-main-col" style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {preview && (
                <div
                  className="detail-card detail-card-preview"
                  style={{ padding: 0 }}
                  onClick={() => {
                    setLbSrc(preview)
                    setLbScale(1)
                    setLbPan({ x: 0, y: 0 })
                  }}
                >
                  <img
                    className="preview-img"
                    alt={title}
                    src={preview}
                    onError={(e) => {
                      const card = e.currentTarget.closest('.detail-card-preview') as HTMLElement | null
                      if (card) card.style.display = 'none'
                    }}
                  />
                </div>
              )}
              <div className="detail-card">
                <div className="link-head">
                  {extra.categoryName && (
                    <Link className="link-head-cat" href={`/category/${link.categoryId}`} data-discover>
                      {extra.categoryName}
                    </Link>
                  )}
                  <div className="detail-header" style={{ alignItems: 'flex-start' }}>
                    <img
                      className="detail-logo"
                      alt={title}
                      src={logoSrc}
                      onError={(e) => {
                        e.currentTarget.src =
                          'data:image/svg+xml,' +
                          encodeURIComponent(
                            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1171ee" width="100" height="100"/><text fill="white" font-size="52" x="50" y="68" text-anchor="middle">${Array.from(title.trim())[0] || '?'}</text></svg>`
                          )
                      }}
                    />
                    <div style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignSelf: 'stretch' }}>
                      <div className="detail-title-row" style={{ display: 'flex', alignItems: 'center' }}>
                        <h1
                          className="detail-title"
                          style={{
                            margin: 0,
                            minWidth: 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            textDecoration: 'none',
                            ...(isGone ? { color: '#8a919f' } : {}),
                          }}
                        >
                          {title}
                        </h1>
                        <div className="detail-badge-box" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          {isGone ? (
                            <span
                              style={{
                                fontSize: 12,
                                marginLeft: 12,
                                padding: '2px 10px',
                                borderRadius: 10,
                                fontWeight: 600,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                                background: '#fef2f2',
                                color: '#dc2626',
                                border: '1px solid #fecaca',
                              }}
                            >
                              ⚠ 已关站
                            </span>
                          ) : (
                            tag && (
                              <Link
                                href={`/tag/${tag.id}`}
                                style={{
                                  fontSize: 12,
                                  marginLeft: 12,
                                  padding: '3px 10px',
                                  borderRadius: 6,
                                  fontWeight: 600,
                                  flexShrink: 0,
                                  whiteSpace: 'nowrap',
                                  background: tag.bgColor,
                                  color: tag.color,
                                  textDecoration: 'none',
                                }}
                              >
                                <i className={tag.icon} /> {tag.name}
                              </Link>
                            )
                          )}
                        </div>
                      </div>
                      <div className="detail-meta">
                        <span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                          {fmtK(clicks)} 次点击
                        </span>
                        <span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"></path>
                          </svg>
                          {fmtK(likes)} 次收藏
                        </span>
                        {extra.createdAt && (
                          <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="18" height="18" x="3" y="4" rx="2"></rect>
                              <path d="M16 2v4"></path>
                              <path d="M8 2v4"></path>
                              <path d="M3 10h18"></path>
                            </svg>
                            收录于 {fmtDate(extra.createdAt)}
                          </span>
                        )}
                        {extra.updatedAt && (
                          <span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                              <path d="M21 3v5h-5"></path>
                            </svg>
                            更新于 {fmtDate(extra.updatedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {(description || annotation) && (
                  <div className="detail-desc">
                    {description && (
                      <span style={{ flex: '1 1 0%', minWidth: 0 }}>{description}</span>
                    )}
                    {annotation && <span className="detail-annotation">{annotation}</span>}
                  </div>
                )}
                <div className="detail-actions">
                    <button
                      className="btn-visit"
                      onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                    >
                      <span className="status-dot dot-ripple" style={visitDotStyle(mainStatus)} />
                      访问网站
                    </button>
                    <button className={'btn-like' + (liked ? ' faved' : '')} onClick={onLike}>
                      <svg
                        viewBox="0 0 24 24"
                        fill={liked ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"></path>
                      </svg>
                      {liked ? '已收藏' : '收藏'}
                    </button>
                    {!isGone && (
                      <button
                        className={fbPending ? 'btn-report btn-report-pending' : 'btn-report'}
                        onClick={() => {
                          if (!fbPending) {
                            setFbSel(null)
                            setFbOpen(true)
                          }
                        }}
                        title={fbPending ? '已收到反馈，处理完成后可再次提交' : undefined}
                      >
                        {fbPending ? (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            反馈处理中
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
                              <line x1="12" y1="9" x2="12" y2="13"></line>
                              <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            反馈
                          </>
                        )}
                      </button>
                    )}
                  </div>
              </div>
            </div>
            <div className="detail-sidebar">
              <div className="detail-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: '#333', margin: 0 }}>💬 评论 (0)</h2>
                  {user && (
                    <button
                      className="btn-submit"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => setShowBox((v) => (v ? false : true))}
                    >
                      评论
                    </button>
                  )}
                </div>
                {!user && (
                  <p style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
                    请
                    <Link href={'/login?redirect=' + encodeURIComponent(`/link/${link.id}`)} style={{ color: '#1171ee' }}>
                      登录
                    </Link>
                    后评论
                  </p>
                )}
                {user && showBox && (
                  <div className="comment-reply-box" style={{ marginBottom: 12 }}>
                    <input placeholder="说点什么..." maxLength={150} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <div className="comment-reply-actions">
                      <span className={'comment-char-count' + (draft.length >= 150 ? ' full' : '')}>{draft.length}/150</span>
                      <button className="btn-submit" disabled={posting} onClick={post}>
                        {posting ? '发表中…' : '发表'}
                      </button>
                      <button
                        className="btn-cancel"
                        onClick={() => {
                          setShowBox(false)
                          setDraft('')
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                <div className="side-flip-wrap">
                  <p className="no-data">暂无评论</p>
                </div>
              </div>
            </div>
            {related.length > 0 && (
              <div className="detail-sidebar">
                <div className="detail-card" style={{ padding: 20 }}>
                  <h2
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#333',
                      margin: '0 0 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    📚 相关文章 ({related.length})
                  </h2>
                  <div className="side-flip-wrap">
                    <div className="rel-article-list">
                      {related.map((a) => {
                        const cover = asset(a.coverImage)
                        return (
                          <a
                            key={a.id}
                            href={`/articles/${a.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'flex',
                              gap: 10,
                              alignItems: 'center',
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid #f0f0f0',
                              textDecoration: 'none',
                              transition: 'all .15s',
                              background: '#fafafa',
                            }}
                          >
                            {cover && (
                              <img
                                alt=""
                                src={cover}
                                style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                              />
                            )}
                            <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#333',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  lineHeight: 1.4,
                                  wordBreak: 'break-word',
                                }}
                              >
                                {a.title}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', marginTop: 3, gap: 6 }}>
                                <span
                                  style={{
                                    flex: '0 1 auto',
                                    minWidth: 0,
                                    fontSize: 10,
                                    color: '#5ea8ff',
                                    background: '#f0f7ff',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    fontWeight: 500,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {a.categoryName}
                                </span>
                                <span style={{ fontSize: 11, color: '#999', flexShrink: 0, marginLeft: 'auto' }}>
                                  {fmtDate(a.createdAt)}
                                </span>
                              </div>
                            </div>
                          </a>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="detail-lower">
            <div className="detail-section">
              <h2>🔗 访问链接</h2>
              <div className="mirror-list">
                <div className="mirror-item">
                  <span className={'mirror-dot dot-ripple ' + dotClass(mainStatus)} />
                  <a className="mirror-name" href={link.url} target="_blank" rel="nofollow noreferrer">
                    {display}
                  </a>
                  <button className={'mirror-copy-btn' + (copied === 'main' ? ' copied' : '')} onClick={(e) => onCopy(e, 'main', link.url)}>
                    {copied === 'main' ? '✓ 已复制' : '复制链接'}
                  </button>
                </div>
              </div>
            </div>
            {mirrors.length > 0 && (
              <div className="detail-section">
                <h2>🌐 备用链接</h2>
                <div className="mirror-list">
                  {mirrors.map((m) => (
                    <div className="mirror-item" key={m.id}>
                      <span className={'mirror-dot dot-ripple ' + dotClass(mirrorStatus[m.id] ?? null)} />
                      <a className="mirror-name" href={m.url} target="_blank" rel="nofollow noreferrer">
                        {m.name || m.url}
                      </a>
                      <button className={'mirror-copy-btn' + (copied === m.id ? ' copied' : '')} onClick={(e) => onCopy(e, m.id, m.url)}>
                        {copied === m.id ? '✓ 已复制' : '复制链接'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ads.length > 0 && (
              <div className="detail-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ads.map((ad) => (
                    <a
                      key={ad.id}
                      href={ad.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'block', borderRadius: 8, overflow: 'hidden' }}
                    >
                      <img
                        alt={ad.title}
                        src={asset(ad.imageUrl) || ad.imageUrl}
                        style={{ width: '100%', display: 'block', aspectRatio: '1200 / 80' }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {extra.detail && (
              <div className="detail-section">
                <h2>📝 详情介绍</h2>
                <div className="article-detail-content" dangerouslySetInnerHTML={{ __html: localHtml(extra.detail) }} />
              </div>
            )}
          </div>
        </div>
      </div>
      {lbSrc && (
        <div
          className="lightbox-overlay"
          onClick={closeLb}
          onWheel={(e) => setLbScale((s) => Math.max(0.5, Math.min(5, s + (e.deltaY < 0 ? 0.2 : -0.2))))}
        >
          <img
            className="lightbox-img"
            src={lbSrc}
            alt={title}
            draggable={false}
            style={{
              transform: `scale(${lbScale}) translate(${lbPan.x}px, ${lbPan.y}px)`,
              cursor: lbScale > 1 ? (lbDrag ? 'grabbing' : 'grab') : 'zoom-in',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (lbScale === 1) setLbScale(2)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setLbScale((s) => (s > 1 ? 1 : 3))
              setLbPan({ x: 0, y: 0 })
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              if (lbScale > 1) {
                setLbDrag(true)
                panRef.current = { x: e.clientX, y: e.clientY, px: lbPan.x, py: lbPan.y }
              }
            }}
            onMouseMove={(e) => {
              if (lbDrag && lbScale > 1) {
                setLbPan({
                  x: panRef.current.px + (e.clientX - panRef.current.x) / lbScale,
                  y: panRef.current.py + (e.clientY - panRef.current.y) / lbScale,
                })
              }
            }}
            onMouseUp={() => setLbDrag(false)}
            onMouseLeave={() => setLbDrag(false)}
          />
          <div className="lightbox-tools">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setLbScale((s) => Math.max(0.5, s - 0.5))
              }}
            >
              −
            </button>
            <span>{Math.round(lbScale * 100)}%</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setLbScale((s) => Math.min(5, s + 0.5))
              }}
            >
              ＋
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setLbScale(1)
                setLbPan({ x: 0, y: 0 })
              }}
            >
              重置
            </button>
          </div>
          <button className="lightbox-close" aria-label="关闭" onClick={(e) => {
            e.stopPropagation()
            closeLb()
          }}>
            ✕
          </button>
        </div>
      )}
      {fbOpen && (
        <div className="lightbox-overlay fb-overlay" onClick={() => setFbOpen(false)}>
          <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fb-modal-head">
              <div className="fb-modal-ico">⚠️</div>
              <div>
                <h3 className="fb-modal-title">反馈问题</h3>
                <div className="fb-modal-sub">选择遇到的问题类型，我们会尽快处理</div>
              </div>
              <button className="fb-modal-close" aria-label="关闭" onClick={() => setFbOpen(false)}>
                ✕
              </button>
            </div>
            <div className="fb-modal-body">
              {FB_TYPES.map((t) => (
                <label key={t.id} className={fbSel === t.id ? 'fb-opt on' : 'fb-opt'}>
                  <input type="radio" name="fb-type" checked={fbSel === t.id} onChange={() => setFbSel(t.id)} />
                  <span className="fb-dot" />
                  {t.name}
                  <span className="fb-check">✔</span>
                </label>
              ))}
              {FB_TYPES.length === 0 && <p className="fb-modal-empty">暂无可用反馈类型</p>}
            </div>
            <div className="fb-modal-foot">
              <button className="fb-btn-cancel" onClick={() => setFbOpen(false)}>
                取消
              </button>
              <button className="fb-btn-submit" disabled={fbBusy} onClick={submitFb}>
                {fbBusy ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
