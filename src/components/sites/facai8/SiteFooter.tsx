import Link from 'next/link'
import { getContentRepository } from '@/lib/facai8/content/source'
import { asset } from '@/lib/facai8/util'

// P8-3：页脚站点信息改走统一内容仓库（server 组件）。
export async function SiteFooter() {
  const settings = await getContentRepository().getSiteSettings()
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <div className="footer-brand-name">
            <img alt="" className="footer-brand-logo" src={asset(settings.siteLogo) || ''} />
            <span>{settings.siteName}</span>
          </div>
          <p className="footer-desc">{settings.siteDescription}</p>
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
        © 2026 {settings.siteName} {settings.footerText}
      </div>
    </footer>
  )
}
