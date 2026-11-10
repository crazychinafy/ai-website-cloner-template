import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// 源站 About-xOQPXFIA.js → SiteInfoPage 基座（/about，footer 链接；公开页无守卫）。
// 本地差异：正文 SSR 直出（源站客户端取数，内容逐字节一致，见 site-static.ts 注释）；标题走 metadata（源站 `document.title = 关于我们 - 彩搜搜`）。
export function generateMetadata() {
  return { title: `关于我们 - ${SITE_INFO.siteName}` }
}

export default async function AboutPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="aboutUs" />
    </SiteFrame>
  )
}
