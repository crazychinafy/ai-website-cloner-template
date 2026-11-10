import { redirect } from 'next/navigation'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { MemberShell } from '@/components/sites/facai8/MemberShell'
import { MyComments } from '@/components/sites/facai8/MyComments'

// 源站 /my-comments（bi，`Ii` 守卫包裹）：未登录 → /login?redirect=%2Fmy-comments。
// mp-hero（💬 我的评论）+ 状态过滤（全部/已通过/审核中/已拒绝）+ 空态。测试账号 0 评论 = 真实态。

export async function generateMetadata() {
  return {
    title: `我的评论 - ${SITE_INFO.siteName}`,
    description: `你发表的评论及审核进度`,
  }
}

export default async function MyCommentsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?redirect=%2Fmy-comments')
  return (
    <SiteFrame user={user} barVariant={null}>
      <MemberShell active="comments" pathname="/my-comments">
        <MyComments />
      </MemberShell>
    </SiteFrame>
  )
}
