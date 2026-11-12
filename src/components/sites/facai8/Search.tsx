'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { asset, gstaticFavicon } from '@/lib/facai8/util'
import type { SearchArticleDto, SearchLinkDto, SearchResults } from '@/lib/facai8/content/types'
import { Truncate, hlNodes } from './Truncate'

// 源站 /search（懒加载 chunk Search）本地等价：独立居中面板、10 字符上限、网址/文章双标签、
// 15 条/页分页、hl 高亮、截断 tooltip。
// P8-4：搜索由页面层 repo.searchLinks/searchArticles 服务端执行后经 props 注入（旧 util 值导入已废除）；
// 标签切换在两份已取结果间切换、分页本地切片，均无需取数 → 仍无加载骨架/错误态。

const PAGE_SIZE = 15
const TABS = [
  { key: 'link', label: '网址' },
  { key: 'article', label: '文章' },
] as const
type TabKey = (typeof TABS)[number]['key']

type Row = { type: 'link' } & SearchLinkDto | { type: 'article' } & SearchArticleDto

/** 链接图标：有 logo 用本地素材，无 logo 用源站同款 gstatic favicon */
function logoSrc(r: SearchLinkDto): string {
  if (r.logoUrl) {
    if (r.logoUrl.startsWith('http')) return r.logoUrl
    return asset(r.logoUrl) || ''
  }
  return gstaticFavicon(r.url)
}

export function Search({
  q,
  initialTab,
  initialPage,
  linkResults,
  articleResults,
}: {
  q: string
  initialTab: TabKey
  initialPage: number
  linkResults: SearchResults<SearchLinkDto>
  articleResults: SearchResults<SearchArticleDto>
}) {
  const router = useRouter()

  const [input, setInput] = useState(q)
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [page, setPage] = useState(initialPage)

  // 服务端已截断（SEARCH_LINK_LIMIT/SEARCH_ARTICLE_LIMIT）：分页以已取 items 为准，
  // 「共 N 条」展示 total（未截断命中总数，与旧客户端全量搜索一致）。
  const list: Row[] =
    tab === 'link'
      ? linkResults.items.map((x) => ({ ...x, type: 'link' as const }))
      : articleResults.items.map((x) => ({ ...x, type: 'article' as const }))
  const total = tab === 'link' ? linkResults.total : articleResults.total

  const pages = Math.ceil(list.length / PAGE_SIZE)
  const rows = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  // 提交（按钮 / Enter）：更新输入 + 页码归零 + replace 导航（源站同款）
  const submit = (e: string) => {
    setInput(e)
    setPage(0)
    if (!e.trim()) {
      router.replace('/search')
      return
    }
    router.replace(`/search?q=${encodeURIComponent(e)}&t=${tab}`)
  }

  // 切换标签：页码归零；有查询时更新 t 参数
  const switchTab = (k: TabKey) => {
    setTab(k)
    setPage(0)
    if (q) router.replace(`/search?q=${encodeURIComponent(q)}&t=${k}`)
  }

  // 翻页（源站：更新 p 参数 + 回顶）
  const gotoPage = (p: number) => {
    if (p < 0 || p >= pages || p === page) return
    setPage(p)
    if (q) router.replace(`/search?q=${encodeURIComponent(q)}&t=${tab}${p > 0 ? `&p=${p + 1}` : ''}`)
    window.scrollTo(0, 0)
  }

  return (
    <div className="srch-panel">
      <div className="srch-bar">
        <svg className="srch-bar-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(input)
          }}
          placeholder={tab === 'link' ? '搜索网址...' : '搜索文章...'}
          autoFocus={!q}
          maxLength={10}
          className="srch-input"
        />
        {input && (
          <span className={'srch-count' + (input.length >= 10 ? ' is-max' : '')} title="最多输入10个字符">
            {input.length}/10
          </span>
        )}
        {input && (
          <button
            className="srch-clear"
            title="清空"
            onClick={() => {
              setInput('')
              setPage(0)
              router.replace('/search')
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
        <button onClick={() => submit(input)} disabled={!input.trim()} className="srch-btn">
          搜索
        </button>
      </div>
      <div className="srch-toolbar">
        <div className="srch-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={'srch-tab' + (tab === t.key ? ' active' : '')} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {q && (
          <span className="srch-total">
            共 <b>{total}</b> 条结果
          </span>
        )}
      </div>
      {!q && (
        <div className="srch-welcome">
          <div className="srch-welcome-ico">✨</div>
          <div className="srch-welcome-title">搜索站内内容</div>
          <div className="srch-welcome-sub">输入关键词查找收录的网址与文章，最多 10 个字符</div>
        </div>
      )}
      {rows.length > 0 ? (
        <div className="side-flip-wrap">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((r, i) => (
              <div
                key={r.type + '-' + r.id}
                className="srch-card"
                style={{ animationDelay: Math.min(i * 30, 300) + 'ms', cursor: 'pointer' }}
                onClick={() => window.open(r.type === 'link' ? `/link/${r.id}` : `/articles/${r.id}`, '_blank', 'noopener')}
              >
                <div className={'srch-card-ico' + (r.type === 'article' ? ' is-article' : '')}>
                  {r.type === 'link' ? (
                    <img
                      src={logoSrc(r)}
                      alt=""
                      style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'contain' }}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 20 }}>📝</span>
                  )}
                </div>
                <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Truncate className="srch-card-title" text={r.title}>
                      {hlNodes(r.title, q)}
                    </Truncate>
                    {r.categoryName && <span className="srch-cat">{r.categoryName}</span>}
                  </div>
                  <Truncate className="srch-card-desc" text={r.description || ''}>
                    {hlNodes(r.description || '', q)}
                  </Truncate>
                </div>
                {r.type === 'link' ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="srch-goto"
                    data-tip="直达"
                    onClick={(e) => {
                      e.stopPropagation()
                      // 源站此处 POST 点击数记录；本地无该 API，仅阻止冒泡
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </a>
                ) : (
                  <>
                    <span className="srch-type is-article">文章</span>
                    <svg className="srch-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : q ? (
        <div className="srch-empty">
          <div className="srch-empty-ico">🔍</div>
          <div style={{ fontSize: 16, color: '#5f6b7a', marginBottom: 8, fontWeight: 600 }}>未找到「{q}」相关结果</div>
          <div style={{ fontSize: 13, color: '#8a919f' }}>试试缩短关键词、更换关键词，或检查拼写</div>
        </div>
      ) : null}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28, alignItems: 'center' }}>
          <button disabled={page === 0} onClick={() => gotoPage(page - 1)} className="srch-page-btn">
            ‹ 上一页
          </button>
          <span className="srch-page-info">
            {page + 1} / {pages}
          </span>
          <button disabled={page >= pages - 1} onClick={() => gotoPage(page + 1)} className="srch-page-btn">
            下一页 ›
          </button>
        </div>
      )}
    </div>
  )
}
