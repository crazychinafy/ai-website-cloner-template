import { redirect } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { MemberShell } from '@/components/sites/facai8/MemberShell'
import { Profile } from '@/components/sites/facai8/Profile'

// 源站 /profile（mi，`Ii` 守卫包裹）：未登录 → /login?redirect=%2Fprofile；已登录 → 个人资料页。
// 本地 = 服务端 getSessionUser 守卫（HttpOnly cookie）+ 共享窄左栏 + pf 结构。测试账号零内容 = 真实态。

// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: `个人资料 - ${settings.siteName}`,
    description: `管理你的资料、修改密码与联系方式`,
  }
}

export default async function ProfilePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=%2Fprofile')
  return (
    <SiteFrame user={user} barVariant={null}>
      <MemberShell active="profile" fill={false} pathname="/profile">
        <Profile username={user.username} avatar={user.avatar} />
      </MemberShell>
    </SiteFrame>
  )
}
