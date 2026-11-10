'use client'
import type { ReactNode } from 'react'
import Link from 'next/link'

// 源站 4 个会员页共享布局 1:1：`main-layout` > 窄左栏 `aside.sidebar`（个人中心 + 4 项 + 红色退出）
// + `main.content[.flip-fill]` > `mobile-sub-nav`（移动端）+ 页面内容。
// 注：左侧窄栏 ≠ 首页 58 分类左栏（SideNav）；源站会员页无分类左栏。
// 退出登录 = 源站 Ur/ne/Qe 1:1（POST /api/auth/logout → sessionStorage login_notice → 整页跳 /login?redirect=当前路径）。

const SIDE_ITEMS = [
  { key: 'profile', href: '/profile', label: '👤 个人资料' },
  { key: 'favorites', href: '/favorites', label: '⭐ 我的收藏' },
  { key: 'comments', href: '/my-comments', label: '💬 我的评论' },
  { key: 'posts', href: '/my-posts', label: '📝 我的发布' },
] as const

const MOBILE_ITEMS = [
  { key: 'profile', href: '/profile', label: '👤 资料' },
  { key: 'favorites', href: '/favorites', label: '⭐ 收藏' },
  { key: 'comments', href: '/my-comments', label: '💬 评论' },
  { key: 'posts', href: '/my-posts', label: '📝 发布' },
] as const

type MemberKey = (typeof SIDE_ITEMS)[number]['key']

export function MemberShell({
  active,
  fill = true,
  pathname,
  children,
}: {
  active: MemberKey
  fill?: boolean // profile=false（源站 content 无 flip-fill）；favorites/comments/posts=true
  pathname: string // 用于退出登录后 redirect 回当前页
  children: ReactNode
}) {
  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* 忽略网络错误，仍跳转登录页 */
    }
    try {
      sessionStorage.setItem('login_notice', '已退出登录')
    } catch {
      /* SSR/隐私模式 */
    }
    // 源站 Ur = 整页硬跳转（Vite SPA：重播登录页入场动画 + 重走 boot 流程）；Next 客户端导航不做整页 reload，此处刻意 1:1
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?redirect=${encodeURIComponent(pathname)}`
  }

  return (
    <div className="main-layout">
      <aside className="sidebar">
        <div className="sidebar-title">个人中心</div>
        <nav className="side-nav">
          {SIDE_ITEMS.map((it) => (
            <Link key={it.key} href={it.href} className={`side-item ${active === it.key ? 'active' : ''}`}>
              {it.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 16, padding: '0 14px' }}>
          <button type="button" className="pf-logout" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </aside>
      <main className={`content ${fill ? 'flip-fill' : ''}`.trim()}>
        <div className="mobile-sub-nav">
          {MOBILE_ITEMS.map((it) => (
            <Link key={it.key} href={it.href} className={active === it.key ? 'active' : ''}>
              {it.label}
            </Link>
          ))}
        </div>
        {children}
      </main>
    </div>
  )
}
