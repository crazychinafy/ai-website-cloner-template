import { ARTICLE_CATEGORIES } from '@/lib/facai8/data/article-categories'
import { ALL_ARTICLES } from '@/lib/facai8/data/articles'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ArticlesShell } from '@/components/sites/facai8/ArticlesShell'

export const metadata = {
  title: SITE_INFO.siteName,
  description: SITE_INFO.siteDescription,
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const user = await getSessionUser()

  // 源站：无 category 参数时默认第一个分类（黑平台曝光），URL 保持不变
  const catId = typeof sp.category === 'string' ? sp.category : ''
  const active = ARTICLE_CATEGORIES.find((c) => c.id === catId) ?? ARTICLE_CATEGORIES[0]

  // 源站列表按创建时间倒序（API content 顺序）
  const articles = ALL_ARTICLES.filter((a) => a.categoryId === active.id).sort((a, b) =>
    a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)
  )

  return (
    <SiteFrame user={user} barVariant="articles">
      <ArticlesShell cats={ARTICLE_CATEGORIES} activeId={active.id} articles={articles} />
    </SiteFrame>
  )
}
