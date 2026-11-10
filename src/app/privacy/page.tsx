import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// 源站 Privacy-DAXynwBU.js → SiteInfoPage 基座（/privacy，footer 链接；公开页无守卫）。
export function generateMetadata() {
  return { title: `隐私政策 - ${SITE_INFO.siteName}` }
}

export default async function PrivacyPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="privacy" />
    </SiteFrame>
  )
}
