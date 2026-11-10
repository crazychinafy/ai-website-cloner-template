import { Suspense } from 'react'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SubmitArticle } from '@/components/sites/facai8/SubmitArticle'

// 源站 /submit-article：实测 document.title 恒为「彩搜搜」（无路由专属标题）；移动端无底栏
export const metadata = {
  title: '彩搜搜',
}

export default async function SubmitArticlePage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <Suspense>
        <SubmitArticle loggedIn={user !== null} />
      </Suspense>
    </SiteFrame>
  )
}
