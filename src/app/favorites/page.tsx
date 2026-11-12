import { redirect } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { MemberShell } from '@/components/sites/facai8/MemberShell'
import { Favorites } from '@/components/sites/facai8/Favorites'

// 源站 /favorites（ii，`Ii` 守卫包裹）：未登录 → /login?redirect=%2Ffavorites。
// mp-hero（⭐ 我的收藏 + 网址/文章分段）+ 空态。测试账号 0 收藏 = 真实态。

// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: `我的收藏 - ${settings.siteName}`,
    description: `你收藏的网址与文章`,
  }
}

export default async function FavoritesPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=%2Ffavorites')
  return (
    <SiteFrame user={user} barVariant={null}>
      <MemberShell active="favorites" pathname="/favorites">
        <Favorites />
      </MemberShell>
    </SiteFrame>
  )
}
