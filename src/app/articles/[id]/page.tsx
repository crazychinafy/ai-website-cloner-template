import { notFound } from 'next/navigation'
import { getContentRepository } from '@/lib/facai8/content/source'
import type { AdDto } from '@/lib/facai8/content/types'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { ArticleDetail, type RelatedLinkView } from '@/components/sites/facai8/ArticleDetail'

// P8-3（第 3 组）：文章详情数据改走统一内容仓库（static/mysql 双源同构）；
// 相关网址的分类名/详情日期由页面层补齐（原 ArticleDetail 组件级 CAT_NAME/REL_DATE 已废除）。

/** 源站 detail-lower 从广告池随机 3 条；本地固定用 DOM 存档那 3 个（ffbm6 / USDT.VIP / 52game）。
 *  选择逻辑保留在页面层，广告池来自 repo.getAds()（可见性已过滤）。 */
const LOWER_AD_URLS = [
  'https://ffbm6.com/?id=305903414',
  'https://153.43.91.12:18028/?cid=8814886',
  'https://www.52game.cn.com/?cid=1922270',
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
  const [a, settings] = await Promise.all([repo.getArticleById(id), repo.getSiteSettings()])
  // 源站 `ti` 标题 effect：jr(r.seoTitle || r.title || "文章详情") → 「{…} - 彩搜搜」
  const meta: { title: string; description: string; keywords?: string } = {
    title: (a?.seoTitle || a?.title || '文章详情') + ` - ${settings.siteName}`,
    // 源站 Nr("description", r.seoDescription || r.title || "")
    description: (a?.seoDescription || a?.title || '').slice(0, 160),
  }
  // 源站 Nr 空值跳过（if(!t) return）→ seoKeywords 为空时不写 keywords meta
  if (a?.seoKeywords) meta.keywords = a.seoKeywords
  return meta
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const repo = getContentRepository()
  const [article, user] = await Promise.all([repo.getArticleById(id), getSessionUser()])
  if (!article) notFound()

  const [related, ads, catTree] = await Promise.all([
    repo.getRelatedLinksForArticle(article.id),
    repo.getAds().then(pickLowerAds),
    repo.getHomeCategories(),
  ])
  // 徽章分类名映射（旧组件级 CAT_NAME 等价：顶层 + 子级全量）
  const catName = new Map<string, string>()
  for (const c of catTree) {
    catName.set(c.id, c.name)
    for (const s of c.children) catName.set(s.id, s.name)
  }
  // 日期仅「详情已存档」的相关网址显示（旧 REL_DATE 映射等价：getLinkDetail 无档 → null）
  const details = await Promise.all(related.map((l) => repo.getLinkDetail(l.id)))
  const relatedView: RelatedLinkView[] = related.map((l, i) => ({
    ...l,
    categoryName: catName.get(l.categoryId) ?? '',
    detailCreatedAt: details[i]?.createdAt ?? null,
  }))

  return (
    <SiteFrame user={user} barVariant={null}>
      <ArticleDetail article={article} related={relatedView} ads={ads} user={user} />
    </SiteFrame>
  )
}
