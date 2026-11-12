import { Suspense } from 'react'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ForgotPassword } from '@/components/sites/facai8/ForgotPassword'

// 源站：`忘记密码` + 站名后缀（ForgotPassword chunk 标题调用实测 = `忘记密码`）。认证页 = 有顶栏、无页脚、无移动底栏。
// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `忘记密码 - ${settings.siteName}` }
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
