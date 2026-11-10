import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ALL_LINKS } from '@/lib/facai8/data/links'
import { LINK_CATEGORIES } from '@/lib/facai8/data/categories'
import { CAT_ORDER, applyLinkOrder } from '@/lib/facai8/data/link-order'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { CatTagView } from '@/components/sites/facai8/CatTagView'

// 源站 CategoryPage-Bo82ue0g.js（懒加载）：/category/:categoryId → 分类 hero + 链接卡片网格 + 54/页分页。
// 源站 = 客户端 GET /categories/links/{id}(by-id) + /links?categoryId(精确匹配,54/页) + /public/tags；
// 本地 = 服务端静态档案（LINK_CATEGORIES 两级查 + ALL_LINKS 精确过滤）→ SSR 终态，无取数/骨架/错误分支。
// 源站 by-id 返回「库id:字形」冒号 iconUrl，客户端 j() 解析；本地归档即解析后类名 → 直接渲染 cat.icon。

/** 两级查分类（顶层 + 子分类） */
function findCat(id: string) {
  for (const c of LINK_CATEGORIES) {
    if (c.id === id) return { id: c.id, name: c.name, icon: c.icon }
    for (const sub of c.children) if (sub.id === id) return { id: sub.id, name: sub.name, icon: sub.icon }
  }
  return null
}

export async function generateMetadata({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params
  const numeric = /^\d+$/.test(categoryId || '')
  const cat = numeric ? findCat(categoryId) : null
  return {
    // 源站标题 `${name} - ${siteName}`；404 时 `jr(title)` → 「分类不存在 - 彩搜搜」
    title: (cat ? `${cat.name} - ${SITE_INFO.siteName}` : `分类不存在 - ${SITE_INFO.siteName}`),
    description: cat ? `${cat.name}分类收录的优质网址导航，快速找到需要的站点` : SITE_INFO.siteDescription,
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params
  const numeric = /^\d+$/.test(categoryId || '')
  const cat = numeric ? findCat(categoryId) : null
  // 源站 categoryId 精确匹配（含子分类的链接不并入父级；如 国际站 183 卡属子分类 → 父级 total 0 空态）。
  // 顺序 = 源站 /links?categoryId 快照（link-order.ts）；未被快照覆盖时回退档案序。
  const links = cat ? applyLinkOrder(ALL_LINKS.filter((l) => l.categoryId === cat.id), CAT_ORDER[cat.id]) : []
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <CatTagView
        mode="category"
        id={categoryId}
        numeric={numeric}
        item={cat ? { name: cat.name, icon: cat.icon } : null}
        links={links}
      />
    </SiteFrame>
  )
}
