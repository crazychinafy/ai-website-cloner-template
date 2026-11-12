'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { ArticleDto } from '@/lib/facai8/content/types'
import { asset, firstChar, fmtDate } from '@/lib/facai8/util'

// 文章卡片（.art-card：封面 + 标题 + 作者/浏览/日期）
export function ArtCard({ a }: { a: ArticleDto }) {
  const cover = a.coverImage ? asset(a.coverImage) : null
  const avatar = a.authorAvatar ? asset(a.authorAvatar) : null
  return (
    <Link href={`/articles/${a.id}`} className="art-card" target="_blank" rel="noreferrer">
      <div className="art-thumb">
        {cover ? (
          <>
            <div className="art-thumb-img" style={{ backgroundImage: `url(${cover})` }}></div>
            <img alt="" aria-hidden="true" src={cover} style={{ display: 'none' }} />
          </>
        ) : null}
      </div>
      <div className="art-info">
        <h3 className="art-title">{a.title}</h3>
        <div className="art-meta">
          <span className="art-meta-item">
            <span className="art-avatar" style={{ position: 'relative' }}>
              {firstChar(a.authorName)}
              {avatar ? (
                <img alt="" src={avatar} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
            </span>
            <span className="art-author-name">{a.authorName}</span>
          </span>
          <span className="art-meta-item" title={`${a.viewCount} 次阅读`}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 12, height: 12, flexShrink: 0 }}>
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path>
            </svg>
            {a.viewCount}
          </span>
          <span className="art-meta-item">
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 12, height: 12, flexShrink: 0 }}>
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"></path>
            </svg>
            {fmtDate(a.createdAt)}
          </span>
        </div>
      </div>
    </Link>
  )
}

interface PagerProps {
  /** 1 基当前页 */
  page: number
  totalPages: number
  onGo: (p: number) => void
}

// 文章分页（源站分页为客户端状态，URL 只保留 category）
export function ArticlesPager({ page, totalPages, onGo }: PagerProps) {
  const [jump, setJump] = useState('')

  const doJump = () => {
    const v = parseInt(jump, 10)
    if (v >= 1 && v <= totalPages) onGo(v)
  }

  return (
    <div className="articles-pager">
      <button disabled={page <= 1} className="pager-btn" onClick={() => onGo(page - 1)}>
        ‹ 上一页
      </button>
      <span className="pager-info">
        {page} / {totalPages}
      </span>
      <button disabled={page >= totalPages} className="pager-btn" onClick={() => onGo(page + 1)}>
        下一页 ›
      </button>
      <span className="page-jump">
        <input
          className="page-jump-input"
          inputMode="numeric"
          placeholder="页码"
          aria-label="跳转页码"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doJump()
          }}
        />
        <button type="button" className="pager-btn" disabled={!jump} onClick={doJump}>
          跳转
        </button>
      </span>
    </div>
  )
}
