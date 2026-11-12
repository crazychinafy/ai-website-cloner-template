import { redirect } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { MemberShell } from '@/components/sites/facai8/MemberShell'
import { MyPosts } from '@/components/sites/facai8/MyPosts'

// 源站 /my-posts（wi，`Ii` 守卫包裹）：未登录 → /login?redirect=%2Fmy-posts。
// mp-hero（📝 我的发布 + 网址/文章分段）+ 状态过滤（全部/审核中/已发布/已删除）+ 空态。测试账号 0 发布 = 真实态。

// P8-3（第 5 组）：站名后缀改走 repo.getSiteSettings()（P8-6 与正文同源）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: `我的发布 - ${settings.siteName}`,
    description: `你提交的网址及审核进度`,
  }
}

export default async function MyPostsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=%2Fmy-posts')
  return (
    <SiteFrame user={user} barVariant={null}>
      <MemberShell active="posts" pathname="/my-posts">
        <MyPosts />
      </MemberShell>
    </SiteFrame>
  )
}
