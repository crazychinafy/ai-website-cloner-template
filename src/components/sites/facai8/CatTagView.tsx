'use client'
import { useState } from 'react'
import type { LinkItem } from '@/lib/facai8/data/links'
import { LinkCard } from './LinkCard'
import { NotFound } from './NotFound'
import { PageJump } from './PageJump'

const PAGE_SIZE = 54 // 源站 /links 分页 size=54

interface CatTagItem {
  name: string
  icon: string // 已解析 iconfont 类名（本地归档即解析后）
  color?: string // 仅标签页 hero 彩色底用
  bgColor?: string
}

interface Props {
  mode: 'category' | 'tag'
  id: string
  numeric: boolean // /^\d+$/ 守卫
  item: CatTagItem | null // null = 查无此分类/标签 → in-page 404
  links: LinkItem[] // 该 id 全部链接（档案序；服务端已过滤）
}

// 源站 CategoryPage / TagPage 本地等价：数据静态（无 loading/error/bootloader 分支），
// 仅保留 404（in-page NotFound type:link）+ 空态 + 54/页客户端分页。
// 结构同源：container.catpage > catpage-hero(图标+标题+计数) + cat-section > side-flip-wrap > link-container.grid + 分页器。
export function CatTagView({ mode, numeric, item, links }: Props) {
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)

  const isCat = mode === 'category'

  // 404：非数字 ID 或查无（源站 in-page NotFound，type:'link' → 🌐）
  if (!numeric || !item) {
    return (
      <NotFound
        title={isCat ? '分类不存在' : '标签不存在'}
        message={
          isCat
            ? '该分类可能已被删除或回收，请检查链接地址是否正确'
            : '该标签可能已被删除或停用，请检查链接地址是否正确'
        }
        type="link"
      />
    )
  }

  const total = links.length
  const pages = Math.ceil(total / PAGE_SIZE)
  const cur = links.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const go = (p: number) => {
    if (p < 0 || p >= pages || p === page || busy) return
    setBusy(true)
    setPage(p)
    window.scrollTo(0, 0)
    setBusy(false) // 本地数据同步取数 → 立即完成（源站此处异步取数 + 骨架 mask）
  }

  // hero 图标：分类 = 白底(CSS .catpage-hero-icon) + 34 框 + 28px；标签 = 彩色底(inline) + 26px 裸图标
  const heroIcon = isCat ? (
    <div className="catpage-hero-icon">
      <span
        style={{
          width: 34,
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <i className={item.icon} style={{ fontSize: 28, lineHeight: 1 }} />
      </span>
    </div>
  ) : (
    <div
      className="catpage-hero-icon"
      style={{ background: item.bgColor, color: item.color, borderRadius: 10 }}
    >
      <i className={item.icon} style={{ fontSize: 26, lineHeight: 1 }} />
    </div>
  )

  const empty = isCat
    ? { ico: '🗂️', t1: '该分类下暂无网址', t2: '去首页看看其他分类吧' }
    : { ico: '🏷️', t1: '该标签下暂无网址', t2: '去首页看看其他内容吧' }

  return (
    <div className="container catpage">
      <div className="catpage-hero">
        {heroIcon}
        <h2 className="catpage-hero-title">
          <span className="catpage-hero-title-text">{item.name}</span>
        </h2>
        <span className="catpage-hero-count">
          共 <b>{total}</b> 个网址
        </span>
      </div>
      <section className="cat-section">
        {cur.length > 0 ? (
          <div className="side-flip-wrap">
            <div className="link-container grid">
              {cur.map((l) => (
                <LinkCard key={l.id} l={l} showRatingBadge={isCat} />
              ))}
            </div>
          </div>
        ) : (
          <div className="srch-empty">
            <div className="srch-empty-ico">{empty.ico}</div>
            <div style={{ fontSize: 16, color: '#5f6b7a', marginBottom: 8, fontWeight: 600 }}>{empty.t1}</div>
            <div style={{ fontSize: 13, color: '#8a919f' }}>{empty.t2}</div>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              marginTop: 28,
              alignItems: 'center',
              ...(isCat ? { flexWrap: 'wrap' } : {}),
            }}
          >
            <button disabled={busy || page === 0} onClick={() => go(page - 1)} className="srch-page-btn">
              ‹ 上一页
            </button>
            <span className="srch-page-info">
              {page + 1} / {pages}
            </span>
            <button
              disabled={busy || page >= pages - 1}
              onClick={() => go(page + 1)}
              className="srch-page-btn"
            >
              下一页 ›
            </button>
            {isCat && <PageJump max={pages} busy={busy} onGo={go} btnClass="srch-page-btn" />}
          </div>
        )}
      </section>
    </div>
  )
}
