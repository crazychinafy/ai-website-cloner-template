import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// P8-3（第 5 组）：正文与站名后缀均改走统一内容仓库（static/mysql 双源同构）。
// 源站 Privacy-DAXynwBU.js → SiteInfoPage 基座（/privacy，footer 链接；公开页无守卫）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `隐私政策 - ${settings.siteName}` }
}

export default async function PrivacyPage() {
  const repo = getContentRepository()
  const [page, user] = await Promise.all([repo.getSitePage('privacy'), getSessionUser()])
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="privacy" page={page ?? { pageKey: 'privacy', title: '隐私政策', subtitle: '', html: '' }} />
    </SiteFrame>
  )
}
