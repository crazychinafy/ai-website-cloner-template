import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SiteInfoPage } from '@/components/sites/facai8/SiteInfoPage'

// P8-3（第 5 组）：正文与站名后缀均改走统一内容仓库（static/mysql 双源同构）。
// 源站 Agreement-DJ-zUn16.js → SiteInfoPage 基座（/agreement，footer 链接；公开页无守卫）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `用户协议 - ${settings.siteName}` }
}

export default async function AgreementPage() {
  const repo = getContentRepository()
  const [page, user] = await Promise.all([repo.getSitePage('agreement'), getSessionUser()])
  return (
    <SiteFrame user={user} barVariant={null}>
      <SiteInfoPage field="agreement" page={page ?? { pageKey: 'agreement', title: '用户协议', subtitle: '', html: '' }} />
    </SiteFrame>
  )
}
