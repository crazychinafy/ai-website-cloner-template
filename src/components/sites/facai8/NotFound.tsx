'use client'
import Link from 'next/link'

// 源站通用 NotFound 组件 `Rr` 1:1：居中 emoji 圆（按 type 取图标）+ 标题 + 描述 + 返回首页/返回上页。
// 源站在此组件内 `jr(title)` 更新 document.title、`__hideBootLoader` 隐藏启动遮罩；
// 本地标题走 SSR metadata、无 bootloader → 两者无对应分支（纯渲染）。
// 图标映射：link→🌐  article→📄  bulletin→📢  page→🔍
const ICONS = { link: '🌐', article: '📄', bulletin: '📢', page: '🔍' } as const
type NotFoundType = keyof typeof ICONS

export function NotFound({
  title = '页面不存在',
  message = '你访问的内容可能已被删除或链接失效',
  type = 'page',
}: {
  title?: string
  message?: string
  type?: NotFoundType
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '80px 20px',
        maxWidth: 500,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div
        style={{
          fontSize: 72,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecf8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(30,128,255,.08)',
        }}
      >
        {ICONS[type] || '🔍'}
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#252933', margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 14, color: '#8a919f', margin: 0, lineHeight: 1.8, maxWidth: 320 }}>{message}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <Link href="/" className="nf-btn nf-btn-primary">
          <span className="nf-btn-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </span>
          返回首页
        </Link>
        <button onClick={() => window.history.back()} className="nf-btn nf-btn-ghost">
          <span className="nf-btn-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"></path>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </span>
          返回上页
        </button>
      </div>
    </div>
  )
}
