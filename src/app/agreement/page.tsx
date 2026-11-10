import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// 源站 Agreement-DJ-zUn16.js → SiteInfoPage 基座（/agreement，footer 链接；公开页无守卫）。
export function generateMetadata() {
  return { title: `用户协议 - ${SITE_INFO.siteName}` }
}

export default async function AgreementPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="agreement" />
    </SiteFrame>
  )
}
