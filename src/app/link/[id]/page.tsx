import { notFound } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import type { AdDto } from '@/lib/facai8/content/types'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { LinkDetail } from '@/components/sites/facai8/LinkDetail'

// P8-3（第 2 组）：链接详情全部数据改走统一内容仓库（static/mysql 双源同构）。
// 源站无档链接（详情未存档）→ 404 语义保持：getLinkById/getLinkDetail 任一 null 即 notFound()。

/** 源站 detail-lower 从广告池随机 3 条；本地固定用 DOM 存档那 3 个（52game / ffbm6 / USDT.VIP）。
 *  选择逻辑保留在页面层，广告池来自 repo.getAds()（可见性已过滤）。 */
const LOWER_AD_URLS = [
  'https://www.52game.cn.com/?cid=1922270',
  'https://ffbm6.com/?id=305903414',
  'https://153.43.91.12:18028/?cid=8814886',
]
function pickLowerAds(pool: AdDto[]): AdDto[] {
  return LOWER_AD_URLS.map((u) => pool.find((a) => a.linkUrl === u)).filter((a): a is AdDto => !!a)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const repo = getContentRepository()
  const [link, settings] = await Promise.all([repo.getLinkById(id), repo.getSiteSettings()])
  return {
    // 源站 bundle：jr(a.title || "网址详情") → 「{标题} - {siteName}」
    title: (link?.title || '网址详情') + ` - ${settings.siteName}`,
    description: (link?.description || settings.siteDescription).slice(0, 160),
  }
}

export default async function LinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const repo = getContentRepository()
  const [link, extra, user] = await Promise.all([repo.getLinkById(id), repo.getLinkDetail(id), getSessionUser()])
  // 仅重建已存档详情的 122 条链接；其余源站链接（详情数据未存档）→ 404
  if (!link || !extra) notFound()

  const [mirrors, related, ads, tag] = await Promise.all([
    repo.getLinkMirrors(link.id),
    repo.getRelatedArticlesForLink(link.id),
    repo.getAds().then(pickLowerAds),
    link.tagId ? repo.getTagById(link.tagId) : Promise.resolve(null),
  ])
  return (
    <SiteFrame user={user} barVariant={null}>
      <LinkDetail link={link} extra={extra} mirrors={mirrors} related={related} ads={ads} tag={tag} user={user} />
    </SiteFrame>
  )
}
