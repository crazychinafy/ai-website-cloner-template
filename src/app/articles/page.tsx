import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ArticlesShell } from '@/components/sites/facai8/ArticlesShell'

// P8-3（第 3 组）：文章列表数据改走统一内容仓库（static/mysql 双源同构）

export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return { title: settings.siteName, description: settings.siteDescription }
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const repo = getContentRepository()
  const [cats, user] = await Promise.all([repo.getArticleCategories(), getSessionUser()])

  // 源站：无 category 参数时默认第一个分类（黑平台曝光），URL 保持不变
  const catId = typeof sp.category === 'string' ? sp.category : ''
  const active = cats.find((c) => c.id === catId) ?? cats[0]

  // 源站列表按创建时间倒序（repo.getArticles 契约序：createdAt 降序、id 降序）
  const articles = await repo.getArticles({ categoryId: active.id })

  return (
    <SiteFrame user={user} barVariant="articles">
      <ArticlesShell cats={cats} activeId={active.id} articles={articles} />
    </SiteFrame>
  )
}
