import { notFound } from 'next/navigation'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ALL_LINKS } from '@/lib/facai8/data/links'
import { LINK_DETAILS } from '@/lib/facai8/data/link-details'
import { HOME_ADS, type Ad } from '@/lib/facai8/data/ads'
import { getSessionUser } from '@/lib/facai8/auth'
import { mirrorsForLink, relatedArticlesForLink } from '@/lib/facai8/util'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { LinkDetail } from '@/components/sites/facai8/LinkDetail'

function lowerAds(): Ad[] {
  // 源站 detail-lower 从广告池随机 3 条；本地固定用 DOM 存档那 3 个（52game / ffbm6 / USDT.VIP）
  const urls = [
    'https://www.52game.cn.com/?cid=1922270',
    'https://ffbm6.com/?id=305903414',
    'https://153.43.91.12:18028/?cid=8814886',
  ]
  return urls
    .map((u) => HOME_ADS.find((a) => a.linkUrl === u))
    .filter((a): a is Ad => !!a)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const link = ALL_LINKS.find((l) => l.id === id)
  return {
    // 源站 bundle：jr(a.title || "网址详情") → 「{标题} - 彩搜搜」
    title: (link?.title || '网址详情') + ' - 彩搜搜',
    description: (link?.description || SITE_INFO.siteDescription).slice(0, 160),
  }
}

export default async function LinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const link = ALL_LINKS.find((l) => l.id === id)
  const extra = LINK_DETAILS[id]
  // 仅重建已存档详情的 122 条链接；其余源站链接（详情数据未存档）→ 404
  if (!link || !extra) notFound()

  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <LinkDetail
        link={link}
        extra={extra}
        mirrors={mirrorsForLink(link.id)}
        related={relatedArticlesForLink(link)}
        ads={lowerAds()}
        user={user}
      />
    </SiteFrame>
  )
}
