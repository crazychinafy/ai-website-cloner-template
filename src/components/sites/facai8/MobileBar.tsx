'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CatNode } from '@/lib/facai8/data/categories'

export type MobileBarVariant = 'home' | 'articles'

// 移动端底部导航栏（<768px 显示；文章页末项为「网址」）
export function MobileNavBar({ variant = 'home' }: { variant?: MobileBarVariant }) {
  const router = useRouter()
  const openDrawer = () => {
    window.dispatchEvent(new Event('facai8-open-drawer'))
  }
  return (
    <nav className="mobile-nav-bar">
      <div className="mobile-nav-item" onClick={openDrawer}>
        <span className="mobile-nav-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
        </span>
        分类
      </div>
      <Link className="mobile-nav-item nav-cta" href="/submit-article">
        <span className="mobile-nav-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="6" x2="12" y2="18"></line>
            <line x1="6" y1="12" x2="18" y2="12"></line>
          </svg>
        </span>
        投稿
      </Link>
      <div className="mobile-nav-item" onClick={() => router.push('/search?q=')}>
        <span className="mobile-nav-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </span>
        搜索
      </div>
      {variant === 'articles' ? (
        <Link className="mobile-nav-item" href="/">
          <span className="mobile-nav-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M3 12h18"></path>
              <path d="M12 3a15 15 0 0 1 0 18"></path>
              <path d="M12 3a15 15 0 0 0 0 18"></path>
            </svg>
          </span>
          网址
        </Link>
      ) : (
        <Link className="mobile-nav-item" href="/articles">
          <span className="mobile-nav-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <path d="M14 2v6h6"></path>
            </svg>
          </span>
          文章
        </Link>
      )}
    </nav>
  )
}

interface DrawerProps {
  cats: CatNode[]
  onPick?: (catId: string, subId?: string) => void
  /** 抽屉标题（默认「网址分类」） */
  title?: string
  /** 文章页样式：朴素标题头（无 ✕）+ 12px 蓝字图标 */
  articleMode?: boolean
  activeId?: string
}

// 移动端分类抽屉（渲染在 main-layout 内，桌面隐藏）
export function MobileCatDrawer({ cats, onPick, title = '网址分类', articleMode = false, activeId }: DrawerProps) {
  const [open, setOpen] = useState(false)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    const on = () => setOpen(true)
    window.addEventListener('facai8-open-drawer', on)
    return () => window.removeEventListener('facai8-open-drawer', on)
  }, [])

  const icon = (cls: string, size: number, color?: string) =>
    cls ? (
      <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={cls} style={{ fontSize: size, lineHeight: 1, ...(color ? { color } : {}) }}></i>
      </span>
    ) : null

  return (
    <>
      <div className={'mobile-overlay' + (open ? ' open' : ' ')} onClick={() => setOpen(false)}></div>
      <div className={'mobile-drawer' + (open ? ' open' : ' ')}>
        {articleMode ? (
          <div style={{ padding: '12px 16px', fontSize: 16, fontWeight: 600, borderBottom: '1px solid #eee' }}>{title}</div>
        ) : (
          <div
            className="sidebar-title"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setOpen(false)}
          >
            <span className="sidebar-title-text">{title}</span>
            <span className="sidebar-title-arrow" style={{ fontSize: 12, color: '#c2c8d1' }}>✕</span>
          </div>
        )}
        <nav className="side-nav" style={articleMode ? { padding: 8 } : undefined}>
          {cats.map((cat) => (
            <div key={cat.id}>
              <a
                className={'side-item' + (activeId === cat.id ? ' active' : '') + (articleMode ? ' ' : '')}
                style={articleMode ? { paddingLeft: 16 } : undefined}
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onPick?.(cat.id)
                  setOpen(false)
                }}
              >
                {icon(cat.icon, articleMode ? 12 : 14, articleMode ? '#1e80ff' : undefined)}
                <span
                  style={
                    articleMode
                      ? { flex: '1 1 0%' }
                      : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  }
                >
                  {cat.name}
                </span>
                {cat.children.length > 0 && !articleMode && (
                  <span
                    className="side-toggle"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setOpenCats((p) => {
                        const n = new Set(p)
                        if (n.has(cat.id)) n.delete(cat.id)
                        else n.add(cat.id)
                        return n
                      })
                    }}
                  >
                    {openCats.has(cat.id) ? '▾' : '▸'}
                  </span>
                )}
              </a>
              {cat.children.length > 0 && !articleMode && (
                <div className={'side-sub-wrap' + (openCats.has(cat.id) ? ' open' : '')}>
                  <div className="side-sub-inner">
                    {cat.children.map((c) => (
                      <a
                        key={c.id}
                        className="side-item side-sub-item"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          onPick?.(cat.id, c.id)
                          setOpen(false)
                        }}
                      >
                        {icon(c.icon, 14)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
