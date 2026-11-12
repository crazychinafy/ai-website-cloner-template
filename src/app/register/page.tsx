import { Suspense } from 'react'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Register } from '@/components/sites/facai8/Register'

// 源站：`注册` + 站名后缀（Register chunk）。认证页 = 有顶栏、无页脚、无移动底栏。
// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `注册 - ${settings.siteName}` }
}

export default async function RegisterPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} bare barVariant={null}>
      <Suspense>
        <Register />
      </Suspense>
    </SiteFrame>
  )
}
