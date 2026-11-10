import type { SessionUser } from '@/lib/facai8/auth'
import { SiteBg } from './SiteBg'
import { Header } from './Header'
import { SiteFooter } from './SiteFooter'
import { MobileNavBar, type MobileBarVariant } from './MobileBar'

// 源站 app-shell：固定背景 + 吸顶头 + 页面内容 + 页脚 + 移动底栏（认证页无页脚/底栏）
// barVariant=null 时不渲染移动底栏（详情页源站无底栏）
export function SiteFrame({
  user,
  bare = false,
  barVariant = 'home',
  children,
}: {
  user: SessionUser | null
  bare?: boolean
  barVariant?: MobileBarVariant | null
  children: React.ReactNode
}) {
  return (
    <div className="app-shell">
      <SiteBg />
      <Header user={user} />
      <div className="page-fade" style={{ flex: '1 1 0%' }}>
        {children}
      </div>
      {!bare && <SiteFooter />}
      {!bare && barVariant && <MobileNavBar variant={barVariant} />}
    </div>
  )
}
