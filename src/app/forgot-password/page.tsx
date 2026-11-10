import { Suspense } from 'react'
import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ForgotPassword } from '@/components/sites/facai8/ForgotPassword'

// 源站：`忘记密码` + 站名后缀（ForgotPassword chunk 标题调用实测 = `忘记密码`）。认证页 = 有顶栏、无页脚、无移动底栏。
export function generateMetadata() {
  return { title: `忘记密码 - ${SITE_INFO.siteName}` }
}

export default async function ForgotPasswordPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} bare barVariant={null}>
      <Suspense>
        <ForgotPassword />
      </Suspense>
    </SiteFrame>
  )
}
