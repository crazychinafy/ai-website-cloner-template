import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Search } from '@/components/sites/facai8/Search'

// P8-4：搜索改由页面层执行（repo.searchLinks/searchArticles，服务端上限截断），结果随 props 注入。
// 源站：document.title = `搜索：${q}` / `搜索`（+ 站名后缀）；P8-6 后缀与正文同源（settings.siteName）。
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: q ? `搜索：${q} - ${settings.siteName}` : `搜索 - ${settings.siteName}`,
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''
  const initialTab = typeof sp.t === 'string' && sp.t === 'article' ? 'article' : 'link'
  const initialPage = Math.max(0, (parseInt(typeof sp.p === 'string' ? sp.p : '', 10) || 1) - 1)
  const repo = getContentRepository()
  const [user, linkResults, articleResults] = await Promise.all([
    getSessionUser(),
    repo.searchLinks(q),
    repo.searchArticles(q),
  ])
  return (
    <SiteFrame user={user} barVariant={null}>
      <Search
        q={q}
        initialTab={initialTab}
        initialPage={initialPage}
        linkResults={linkResults}
        articleResults={articleResults}
      />
    </SiteFrame>
  )
}
