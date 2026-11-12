import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// P8-3（第 5 组）：正文与站名后缀均改走统一内容仓库（static/mysql 双源同构）。
// 源站 About-xOQPXFIA.js → SiteInfoPage 基座（/about，footer 链接；公开页无守卫）。
// 本地差异：正文 SSR 直出（源站客户端取数，内容逐字节一致，见 site-static.ts 注释）；标题走 metadata（源站 `document.title = 关于我们 - 彩搜搜`）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `关于我们 - ${settings.siteName}` }
}

export default async function AboutPage() {
  const repo = getContentRepository()
  const [page, user] = await Promise.all([repo.getSitePage('aboutUs'), getSessionUser()])
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="aboutUs" page={page ?? { pageKey: 'aboutUs', title: '关于我们', subtitle: '', html: '' }} />
    </SiteFrame>
  )
}
