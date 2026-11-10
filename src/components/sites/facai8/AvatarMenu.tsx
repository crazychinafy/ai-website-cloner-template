'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { asset } from '@/lib/facai8/util'

interface Props {
  user: { username: string; avatar: string | null; initial: string }
}

// 顶栏头像下拉菜单（源站 .user-dropdown 结构）
export function AvatarMenu({ user }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // 源站 Ur：POST /auth/logout（忽略结果）→ 清会话 → 写 login_notice → /login?redirect=pathname+search
  const logout = async () => {
    setOpen(false)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* mock */
    }
    try {
      sessionStorage.setItem('login_notice', '已退出登录')
    } catch {
      /* ignore */
    }
    const target = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)
    // 源站 Ur 即整页跳转（重播入场动画 + 登录页读 login_notice 弹 toast）；此处必须硬导航
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = target
  }

  const item = (href: string, icon: string, label: string, danger = false) => (
    <Link key={href + label} className={'dropdown-item' + (danger ? ' danger' : '')} href={href} onClick={() => setOpen(false)}>
      <span className="dropdown-item-icon">{icon}</span>
      <span>{label}</span>
    </Link>
  )

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="avatar-btn"
        title={user.username}
        onClick={() => setOpen((v) => !v)}
      >
        {user.avatar ? (
          <img src={asset(user.avatar) || user.avatar} alt={user.username} />
        ) : (
          user.initial
        )}
      </button>
      {open && (
        <div className="user-dropdown">
          <div className="dropdown-head">
            <span className="dropdown-avatar">
              {user.avatar ? <img src={asset(user.avatar) || user.avatar} alt="" /> : user.initial}
            </span>
            <div className="dropdown-usertext">
              <div className="dropdown-username">{user.username}</div>
              <div className="dropdown-usersub">欢迎回来 👋</div>
            </div>
          </div>
          {item('/profile', '👤', '个人中心')}
          {item('/favorites', '⭐', '我的收藏')}
          {item('/my-comments', '💬', '我的评论')}
          {item('/my-posts', '📝', '我的发布')}
          <div className="dropdown-divider"></div>
          <button type="button" className="dropdown-item danger" onClick={logout}>
            <span className="dropdown-item-icon">🚪</span>
            <span>退出登录</span>
          </button>
        </div>
      )}
    </div>
  )
}
