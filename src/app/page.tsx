import { getSessionUser } from '@/lib/facai8/auth'
import { getContentRepository } from '@/lib/facai8/content/source'
import { HomeShell } from '@/components/sites/facai8/HomeShell'
import { HomePopup } from '@/components/sites/facai8/HomePopup'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'

// P8-3：首页全部数据改走统一内容仓库（CONTENT_SOURCE=static|mysql 双源同构）。
// 首页分组语义 = getLinksGroupedForHome()：组内档案原始序（与旧 page.tsx groupLinks() 逐位一致）。

export async function generateMetadata() {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: '彩搜搜',
    description: settings.siteDescription,
  }
}

export default async function HomePage() {
  const repo = getContentRepository()
  const [user, cats, linksByCategory, bulletins, ads, settings, newLinks, newArticles, tags] =
    await Promise.all([
      getSessionUser(),
      repo.getHomeCategories(),
      repo.getLinksGroupedForHome(),
      repo.getBulletins(),
      repo.getAds(),
      repo.getSiteSettings(),
      repo.getNewLinks(),
      repo.getNewArticles(),
      repo.getTags(),
    ])
  const tagsById = Object.fromEntries(tags.map((t) => [t.id, t]))
  return (
    <SiteFrame user={user}>
      <HomeShell
        cats={cats}
        linksByCategory={linksByCategory}
        bulletins={bulletins}
        ads={ads}
        stats={settings.stats}
        newLinks={newLinks}
        newArticles={newArticles}
        recentLinks={settings.recentLinks}
        tagsById={tagsById}
      />
      <HomePopup popup={settings.popup} />
    </SiteFrame>
  )
}
