import { Suspense } from 'react'
import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Register } from '@/components/sites/facai8/Register'

// 源站：`注册` + 站名后缀（Register chunk）。认证页 = 有顶栏、无页脚、无移动底栏。
export function generateMetadata() {
  return { title: `注册 - ${SITE_INFO.siteName}` }
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
