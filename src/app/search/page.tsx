import { Suspense } from 'react'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Search } from '@/components/sites/facai8/Search'

// 源站：document.title = `搜索：${q}` / `搜索`（+ 站名后缀）
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''
  return {
    title: q ? `搜索：${q} - 彩搜搜` : '搜索 - 彩搜搜',
  }
}

export default async function SearchPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <Suspense>
        <Search />
      </Suspense>
    </SiteFrame>
  )
}
