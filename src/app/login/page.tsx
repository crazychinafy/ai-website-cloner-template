import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Login } from '@/components/sites/facai8/Login'

// 源站：`登录` + 站名后缀（index chunk Lr effect）。认证页 = 有顶栏、无页脚、无移动底栏。
export function generateMetadata() {
  return { title: `登录 - ${SITE_INFO.siteName}` }
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
