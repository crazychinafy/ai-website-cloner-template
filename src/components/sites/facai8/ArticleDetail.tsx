'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Article } from '@/lib/facai8/data/articles'
import type { LinkItem } from '@/lib/facai8/data/links'
import type { Ad } from '@/lib/facai8/data/ads'
import type { SessionUser } from '@/lib/facai8/auth'
import { LINK_CATEGORIES } from '@/lib/facai8/data/categories'
import { LINK_DETAILS } from '@/lib/facai8/data/link-details'
import { asset, firstChar, fmtDate, fmtDateCn, gstaticFavicon, localHtml } from '@/lib/facai8/util'

// 分类 id → 名称（相关网址徽章用）
const CAT_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const c of LINK_CATEGORIES) {
    m[c.id] = c.name
    for (const sub of c.children) m[sub.id] = sub.name
  }
  return m
})()

// 相关网址日期（link-details 存档中有的才显示）
const REL_DATE: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const l of Object.values(LINK_DETAILS)) m[l.id] = fmtDate(l.createdAt)
  return m
})()

interface Props {
  article: Article
  related: LinkItem[]
  ads: Ad[]
  user: SessionUser | null
}

// 文章详情页：头部 + 正文 + 评论侧栏 + 相关网址侧栏 + 底部广告（源站 detail-page-wide 1500px）
export function ArticleDetail({ article, related, ads, user }: Props) {
  const router = useRouter()
  const [liked, setLiked] = useState(false)
  const [showBox, setShowBox] = useState(true)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const cover = article.authorAvatar ? asset(article.authorAvatar) : null
  const contentHtml = localHtml(article.content)
  const commentCount = 0

  // 源站 Fr/Ir：往 document.head 注入 schema.org Article 结构化数据（单 <script type="application/ld+json">），卸载时移除
  useEffect(() => {
    const s = document.createElement('script')
    s.type = 'application/ld+json'
    s.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.seoDescription || '',
      image: article.coverImage || '',
      datePublished: article.createdAt,
      dateModified: article.updatedAt,
      author: { '@type': 'Person', name: article.authorName || '管理员' },
      mainEntityOfPage: window.location.origin + '/articles/' + article.id,
    })
    document.head.appendChild(s)
    return () => s.remove()
  }, [article])

  const onLike = () => {
    if (!user) {
      router.push('/login?redirect=' + encodeURIComponent(`/articles/${article.id}`))
      return
    }
    setLiked((v) => !v)
  }

  const post = () => {
    if (!draft.trim() || posting) return
    setPosting(true)
    // Mock：本地不持久化评论，仅演示交互流程（源站：提交后进入审核中列表）
    setTimeout(() => {
      setPosting(false)
      setDraft('')
      setShowBox(false)
    }, 600)
  }

  return (
    <div className="container detail-page article-detail-page detail-page-wide">
      <div className="detail-body">
        <div style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="detail-main-top">
            <div className="detail-main-col" style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="detail-card">
                <div className="article-head" style={{ marginBottom: 0 }}>
                  <Link className="article-head-tag" href={`/articles?category=${article.categoryId}`}>
                    {article.categoryName}
                  </Link>
                  <h1 className="detail-title-clamp article-head-title">{article.title}</h1>
                  <div className="article-author-row article-head-author">
                    <div
                      className="author-avatar-lg"
                      title="查看作者资料"
                      style={{ cursor: 'pointer', overflow: 'hidden', position: 'relative' }}
                    >
                      {firstChar(article.authorName)}
                      {cover ? (
                        <img
                          alt=""
                          src={cover}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                    </div>
                    <div className="author-info-col">
                      <span className="author-name" title="查看作者资料" style={{ cursor: 'pointer' }}>
                        {article.authorName}
                      </span>
                      <div className="author-date-row">
                        <span>{fmtDateCn(article.createdAt)}</span>
                        <span className="dot-sep">·</span>
                        <span>{article.viewCount} 阅读</span>
                      </div>
                    </div>
                    <button
                      className="btn-like"
                      style={{ marginLeft: 'auto', padding: '8px 16px' }}
                      onClick={onLike}
                    >
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
                  </div>
                </div>
              </div>
              <div className="detail-card">
                <div className="article-detail-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
              </div>
            </div>
            <div className="detail-sidebar">
              <div className="detail-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: '#333', margin: 0 }}>💬 评论 ({commentCount})</h2>
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
                    <Link href={'/login?redirect=' + encodeURIComponent(`/articles/${article.id}`)} style={{ color: '#1171ee' }}>
                      登录
                    </Link>
                    后评论
                  </p>
                )}
                {user && showBox && (
                  <div className="comment-reply-box" style={{ marginBottom: 12 }}>
                    <input
                      placeholder="说点什么..."
                      maxLength={150}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="comment-reply-actions">
                      <span className={'comment-char-count' + (draft.length >= 150 ? ' full' : '')}>
                        {draft.length}/150
                      </span>
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
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1171ee"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                    相关网址 ({related.length})
                  </h2>
                  <div className="side-flip-wrap">
                    <div className="rel-article-list">
                      {related.map((l) => {
                        const logo = l.logoUrl ? asset(l.logoUrl) || gstaticFavicon(l.url) : gstaticFavicon(l.url)
                        const catName = CAT_NAME[l.categoryId] || ''
                        return (
                          <a
                            key={l.id}
                            href={`/link/${l.id}`}
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
                            <img
                              alt=""
                              src={logo}
                              style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'contain', background: '#fff', padding: 4, flexShrink: 0 }}
                            />
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
                                {l.title}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', marginTop: 3, gap: 6 }}>
                                {catName && (
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
                                    {catName}
                                  </span>
                                )}
                                {REL_DATE[l.id] && (
                                  <span style={{ fontSize: 11, color: '#999', flexShrink: 0, marginLeft: 'auto' }}>
                                    {REL_DATE[l.id]}
                                  </span>
                                )}
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
          </div>
        </div>
      </div>
    </div>
  )
}
