import { notFound } from 'next/navigation'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ALL_ARTICLES } from '@/lib/facai8/data/articles'
import { HOME_ADS, type Ad } from '@/lib/facai8/data/ads'
import { getSessionUser } from '@/lib/facai8/auth'
import { relatedLinksForArticle } from '@/lib/facai8/util'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ArticleDetail } from '@/components/sites/facai8/ArticleDetail'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const a = ALL_ARTICLES.find((x) => x.id === id)
  // 源站 `ti` 标题 effect：jr(r.seoTitle || r.title || "文章详情") → 「{…} - 彩搜搜」
  const meta: { title: string; description: string; keywords?: string } = {
    title: (a?.seoTitle || a?.title || '文章详情') + ' - ' + SITE_INFO.siteName,
    // 源站 Nr("description", r.seoDescription || r.title || "")
    description: (a?.seoDescription || a?.title || '').slice(0, 160),
  }
  // 源站 Nr 空值跳过（if(!t) return）→ seoKeywords 为空时不写 keywords meta
  if (a?.seoKeywords) meta.keywords = a.seoKeywords
  return meta
}

// 源站 detail-lower 从广告池随机 3 条；本地固定用 DOM 存档那 3 个（ffbm6 / USDT.VIP / 52game）
function lowerAds(): Ad[] {
  const urls = ['https://ffbm6.com/?id=305903414', 'https://153.43.91.12:18028/?cid=8814886', 'https://www.52game.cn.com/?cid=1922270']
  return urls
    .map((u) => HOME_ADS.find((a) => a.linkUrl === u))
    .filter((a): a is Ad => !!a)
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const article = ALL_ARTICLES.find((a) => a.id === id)
  if (!article) notFound()

  const user = await getSessionUser()
  const related = relatedLinksForArticle(article)
  const ads = lowerAds()

  return (
    <SiteFrame user={user} barVariant={null}>
      <ArticleDetail article={article} related={related} ads={ads} user={user} />
    </SiteFrame>
  )
}
