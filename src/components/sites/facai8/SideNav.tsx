'use client'
import { useState } from 'react'
import type { CatNode } from '@/lib/facai8/data/categories'

interface Props {
  cats: CatNode[]
  title: string
  /** 当前选中（文章页用） */
  activeId?: string
  /** 点击分类/子分类回调（首页：滚动+展开+切 tab） */
  onPick?: (catId: string, subId?: string) => void
  /** 条目 href 前缀（文章页：/articles?category=） */
  hrefFor?: (catId: string) => string
  /** 附加类名（文章页：articles-sidebar） */
  className?: string
}

// 左侧分类栏：展开/折叠（◀）、子分类手风琴（▸）、折叠态图标轨道 + 悬浮飞展
export function SideNav({ cats, title, activeId, onPick, hrefFor, className }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

  const toggleSub = (id: string) => {
    setOpenCats((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const pick = (catId: string, subId?: string) => {
    if (subId) toggleSub(catId)
    if (activeId !== undefined) return // 文章页：纯链接跳转
    onPick?.(catId, subId)
  }

  const icon = (cls: string, size: number, color?: string) =>
    cls ? (
      <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={cls} style={{ fontSize: size, lineHeight: 1, ...(color ? { color } : {}) }}></i>
      </span>
    ) : null

  const renderSubs = (cat: CatNode, inFlyout: boolean) =>
    cat.children.length > 0 ? (
      <div className={'side-sub-wrap' + (inFlyout ? ' open' : openCats.has(cat.id) ? ' open' : '')}>
        <div className="side-sub-inner">
          {cat.children.map((c) => (
            <a
              key={c.id}
              className="side-item side-sub-item"
              href={hrefFor ? hrefFor(c.id) : undefined}
              onClick={(e) => {
                if (!hrefFor) e.preventDefault()
                pick(cat.id, c.id)
              }}
            >
              {icon(c.icon, 14)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            </a>
          ))}
        </div>
      </div>
    ) : null

  return (
    <aside className={'sidebar' + (className ? ' ' + className : '') + (collapsed ? ' collapsed' : '')}>
      <div
        className="sidebar-title"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="sidebar-title-text">{title}</span>
        <span className="sidebar-title-arrow" style={{ fontSize: 12, color: '#c2c8d1', flex: '0 0 auto', textAlign: 'center' }}>
          {collapsed ? '▶' : '◀'}
        </span>
      </div>
      <nav className="side-nav">
        {cats.map((cat) => (
          <div key={cat.id}>
            <a
              className={'side-item' + (activeId === cat.id ? ' active' : '')}
              style={{ paddingLeft: 16 }}
              href={hrefFor ? hrefFor(cat.id) : undefined}
              onClick={(e) => {
                if (!hrefFor) e.preventDefault()
                pick(cat.id)
              }}
            >
              {icon(cat.icon, activeId !== undefined ? 12 : 14, activeId !== undefined ? '#1e80ff' : undefined)}
              <span className="" style={{ flex: '1 1 0%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cat.name}
              </span>
              {cat.children.length > 0 && (
                <span className="side-toggle" onClick={(e) => { e.preventDefault(); toggleSub(cat.id) }}>
                  {openCats.has(cat.id) ? '▾' : '▸'}
                </span>
              )}
            </a>
            {renderSubs(cat, false)}
          </div>
        ))}
      </nav>
      <div className="side-rail">
        {cats.map((cat) => (
          <div key={cat.id} className="rail-cat" style={{ position: 'relative' }}>
            <a
              className="side-item"
              title={cat.name}
              href={hrefFor ? hrefFor(cat.id) : undefined}
              style={{ justifyContent: 'center', padding: '6px 8px' }}
              onClick={(e) => {
                if (!hrefFor) e.preventDefault()
                setCollapsed(false)
                pick(cat.id)
              }}
            >
              {icon(cat.icon, 18)}
            </a>
            {cat.children.length > 0 && (
              <div className="rail-flyout">
                <div className="rail-flyout-box">
                  <a className="side-item rail-cat-title" href={hrefFor ? hrefFor(cat.id) : undefined} onClick={(e) => { if (!hrefFor) e.preventDefault(); pick(cat.id) }}>
                    {icon(cat.icon, 14)}
                    <span>{cat.name}</span>
                  </a>
                  {cat.children.map((c) => (
                    <a key={c.id} className="side-item side-sub-item" href={hrefFor ? hrefFor(c.id) : undefined} onClick={(e) => { if (!hrefFor) e.preventDefault(); pick(cat.id, c.id) }}>
                      {icon(c.icon, 14)}
                      <span>{c.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
