import { Suspense } from 'react'
import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { SubmitArticle, type FlatCat } from '@/components/sites/facai8/SubmitArticle'

// 源站 /submit-article：实测 document.title 恒为「彩搜搜」（无路由专属标题）；移动端无底栏
// P8-3/P8-6：标题取 settings.siteName（与正文同源）；分类改走 repo（flatten 规则不变：
// 文章 = 仅叶子；网址 = 父级 + 子级）。
export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: settings.siteName,
  }
}

export default async function SubmitArticlePage() {
  const repo = getContentRepository()
  const [user, linkTree, articleCats] = await Promise.all([
    getSessionUser(),
    repo.getHomeCategories(),
    repo.getArticleCategories(),
  ])
  const flatArticleCats: FlatCat[] = articleCats.map((c) => ({ id: c.id, name: c.name }))
  const linkCats: FlatCat[] = linkTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((k) => ({ id: k.id, name: k.name })),
  ])
  return (
    <SiteFrame user={user} barVariant={null}>
      <Suspense>
        <SubmitArticle loggedIn={user !== null} articleCats={flatArticleCats} linkCats={linkCats} />
      </Suspense>
    </SiteFrame>
  )
}
