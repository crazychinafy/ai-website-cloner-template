import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ALL_LINKS } from '@/lib/facai8/data/links'
import { TAGS } from '@/lib/facai8/data/tags'
import { TAG_ORDER, applyLinkOrder } from '@/lib/facai8/data/link-order'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { CatTagView } from '@/components/sites/facai8/CatTagView'

// 源站 TagPage-Mw_WL-cs.js（懒加载）：/tag/:tagId → 标签 hero（彩色底）+ 链接卡片网格 + 54/页分页。
// 源站 = 客户端 GET /public/tags(全表) + /links?tagId(54/页)；本地 = 服务端静态档案 → SSR 终态。
// 源站 /public/tags 返回冒号 icon，客户端 A() 解析；本地 TAGS 即解析后类名 → 直接渲染 tag.icon。

function findTag(id: string) {
  const t = TAGS.find((x) => x.id === id)
  return t ? { name: t.name, icon: t.icon, color: t.color, bgColor: t.bgColor } : null
}

export async function generateMetadata({ params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params
  const numeric = /^\d+$/.test(tagId || '')
  const tag = numeric ? findTag(tagId) : null
  return {
    // 源站标题 `${name} - ${siteName}`；desc `「${name}」标签收录的优质网址，快速找到需要的站点`
    title: (tag ? `${tag.name} - ${SITE_INFO.siteName}` : `标签不存在 - ${SITE_INFO.siteName}`),
    description: tag ? `「${tag.name}」标签收录的优质网址，快速找到需要的站点` : SITE_INFO.siteDescription,
  }
}

export default async function TagPage({ params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params
  const numeric = /^\d+$/.test(tagId || '')
  const tag = numeric ? findTag(tagId) : null
  // 源站 tagId 精确匹配（如 U站 108 卡 → 54/页 2 页）；顺序 = /links?tagId 快照，未覆盖回退档案序。
  const links = tag ? applyLinkOrder(ALL_LINKS.filter((l) => l.tagId === tagId), TAG_ORDER[tagId]) : []
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <CatTagView
        mode="tag"
        id={tagId}
        numeric={numeric}
        item={tag}
        links={links}
      />
    </SiteFrame>
  )
}
