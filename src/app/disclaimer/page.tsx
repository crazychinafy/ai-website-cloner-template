import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// P8-3（第 5 组）：正文与站名后缀均改走统一内容仓库（static/mysql 双源同构）。
// 源站 Disclaimer-CDUp_74p.js → SiteInfoPage 基座（/disclaimer，footer 链接；公开页无守卫）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `免责声明 - ${settings.siteName}` }
}

export default async function DisclaimerPage() {
  const repo = getContentRepository()
  const [page, user] = await Promise.all([repo.getSitePage('disclaimer'), getSessionUser()])
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage
        field="disclaimer"
        page={page ?? { pageKey: 'disclaimer', title: '免责声明', subtitle: '', html: '' }}
      />
    </SiteFrame>
  )
}
