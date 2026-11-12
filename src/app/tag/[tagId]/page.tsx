import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { CatTagView } from '@/components/sites/facai8/CatTagView'

// 源站 TagPage-Mw_WL-cs.js（懒加载）：/tag/:tagId → 标签 hero（彩色底）+ 链接卡片网格 + 54/页分页。
// 源站 = 客户端 GET /public/tags(全表) + /links?tagId(54/页)；本地 = 服务端统一内容仓库 → SSR 终态。
// 源站 /public/tags 返回冒号 icon，客户端 A() 解析；本地档案即解析后类名 → 直接渲染 tag.icon。
// P8-3：数据源 = getContentRepository()；标签链接序 = getLinksByTag（TAG_ORDER 优先 + 档案序追加，
// MySQL 侧由 site_links.tag_sort_order 复现同一序列，两侧逐位一致）。

export async function generateMetadata({ params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params
  const repo = getContentRepository()
  const numeric = /^\d+$/.test(tagId || '')
  const [settings, tag] = await Promise.all([
    repo.getSiteSettings(),
    numeric ? repo.getTagById(tagId) : Promise.resolve(null),
  ])
  return {
    // 源站标题 `${name} - ${siteName}`；desc `「${name}」标签收录的优质网址，快速找到需要的站点`
    title: (tag ? `${tag.name} - ${settings.siteName}` : `标签不存在 - ${settings.siteName}`),
    description: tag ? `「${tag.name}」标签收录的优质网址，快速找到需要的站点` : settings.siteDescription,
  }
}

export default async function TagPage({ params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params
  const repo = getContentRepository()
  const numeric = /^\d+$/.test(tagId || '')
  const [tag, links, tags, user] = await Promise.all([
    numeric ? repo.getTagById(tagId) : Promise.resolve(null),
    numeric ? repo.getLinksByTag(tagId) : Promise.resolve([]),
    repo.getTags(),
    getSessionUser(),
  ])
  const tagsById = Object.fromEntries(tags.map((t) => [t.id, t]))
  return (
    <SiteFrame user={user} barVariant={null}>
      <CatTagView
        mode="tag"
        id={tagId}
        numeric={numeric}
        item={tag ? { name: tag.name, icon: tag.icon, color: tag.color, bgColor: tag.bgColor } : null}
        links={links}
        tagsById={tagsById}
      />
    </SiteFrame>
  )
}
