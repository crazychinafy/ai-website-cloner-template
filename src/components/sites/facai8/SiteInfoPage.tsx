import { SITE_STATIC, type StaticField } from '@/lib/facai8/data/site-static'

// 源站 SiteInfoPage-DKfpo35q.js 基座 1:1：.site-info-page（4 光斑 aurora + sip-hero 图标/标题/副标题/分隔线 + sip-card 正文）
// 源站差异（本地等价）：源站客户端 GET /api/public/site-info/{field} → 骨架屏 → DOMPurify 净化 + 图片宽高注入；
// 本地正文为静态存档（`site-static.ts`，与源站端点逐字节一致且 4 页均无 <img>）→ 直接 SSR 终态，
// 无 loading/error/bootloader 分支（那些态依赖取数，本地不存在取数）。
// 图标 = 4 个源站 chunk 各自的 svg（24×24 stroke 2，逐属性复刻）。
const ICONS: Record<StaticField, React.ReactNode> = {
  aboutUs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
    </svg>
  ),
  disclaimer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>
  ),
  privacy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>
  ),
  agreement: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M9 13h6M9 17h6"></path>
    </svg>
  ),
}

export function SiteInfoPage({ field }: { field: StaticField }) {
  const { title, subtitle, html } = SITE_STATIC[field]
  return (
    <div className="site-info-page">
      <div className="sip-aurora" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
        <i></i>
      </div>
      <header className="sip-hero">
        <div className="sip-icon">{ICONS[field]}</div>
        <h1 className="sip-title">{title}</h1>
        <p className="sip-subtitle">{subtitle}</p>
        <div className="sip-divider" aria-hidden="true">
          <span></span>
        </div>
      </header>
      <div className="sip-card article-detail-content" dangerouslySetInnerHTML={{ __html: html }}></div>
    </div>
  )
}
