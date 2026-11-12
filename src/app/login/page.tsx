import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Login } from '@/components/sites/facai8/Login'

// 源站：`登录` + 站名后缀（index chunk Lr effect）。认证页 = 有顶栏、无页脚、无移动底栏。
// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: `登录 - ${settings.siteName}` }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const user = await getSessionUser()
  // 源站：已登录（localStorage token）→ replace 到 redirect。本地：服务端等价重定向。
  if (user) {
    const r = typeof sp.redirect === 'string' ? sp.redirect : ''
    const target = r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/login') ? r : '/'
    redirect(target)
  }
  return (
    <SiteFrame user={user} bare barVariant={null}>
      <Suspense>
        <Login />
      </Suspense>
    </SiteFrame>
  )
}
