import { getSessionUser } from '@/lib/facai8/auth'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ALL_LINKS, type LinkItem } from '@/lib/facai8/data/links'
import { LINK_CATEGORIES } from '@/lib/facai8/data/categories'
import { HomeShell } from '@/components/sites/facai8/HomeShell'
import { HomePopup } from '@/components/sites/facai8/HomePopup'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'

function groupLinks(): Record<string, LinkItem[]> {
  const m: Record<string, LinkItem[]> = {}
  for (const l of ALL_LINKS) {
    const arr = m[l.categoryId]
    if (arr) arr.push(l)
    else m[l.categoryId] = [l]
  }
  return m
}

export const metadata = {
  title: '彩搜搜',
  description: SITE_INFO.siteDescription,
}

export default async function HomePage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user}>
      <HomeShell cats={LINK_CATEGORIES} linksByCategory={groupLinks()} />
      <HomePopup />
    </SiteFrame>
  )
}
