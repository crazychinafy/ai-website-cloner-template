import Link from 'next/link'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { asset } from '@/lib/facai8/util'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <div className="footer-brand-name">
            <img alt="" className="footer-brand-logo" src={asset(SITE_INFO.siteLogo) || ''} />
            <span>{SITE_INFO.siteName}</span>
          </div>
          <p className="footer-desc">{SITE_INFO.siteDescription}</p>
        </div>
        <div className="footer-col">
          <div className="footer-col-title">关于</div>
          <Link href="/about">关于我们</Link>
          <Link href="/disclaimer">免责声明</Link>
          <Link href="/agreement">用户协议</Link>
          <Link href="/privacy">隐私政策</Link>
        </div>
      </div>
      <div className="footer-bottom">
        © 2026 {SITE_INFO.siteName} {SITE_INFO.footerText}
      </div>
    </footer>
  )
}
