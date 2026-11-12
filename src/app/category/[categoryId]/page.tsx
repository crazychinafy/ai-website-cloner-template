import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { CatTagView } from '@/components/sites/facai8/CatTagView'

// 源站 CategoryPage-Bo82ue0g.js（懒加载）：/category/:categoryId → 分类 hero + 链接卡片网格 + 54/页分页。
// 源站 = 客户端 GET /categories/links/{id}(by-id) + /links?categoryId(精确匹配,54/页) + /public/tags；
// 本地 = 服务端统一内容仓库（getHomeCategories 两级查 + getLinksByCategory 精确过滤）→ SSR 终态，无取数/骨架/错误分支。
// 源站 by-id 返回「库id:字形」冒号 iconUrl，客户端 j() 解析；本地归档即解析后类名 → 直接渲染 cat.icon。
// P8-3：数据源 = getContentRepository()（static/mysql 同构；分类页序 = getLinksByCategory 规范序）。

/** 两级查分类（顶层 + 子分类） */
async function findCat(id: string) {
  for (const c of await getContentRepository().getHomeCategories()) {
    if (c.id === id) return { id: c.id, name: c.name, icon: c.icon }
    for (const sub of c.children) if (sub.id === id) return { id: sub.id, name: sub.name, icon: sub.icon }
  }
  return null
}

export async function generateMetadata({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params
  const repo = getContentRepository()
  const numeric = /^\d+$/.test(categoryId || '')
  const [settings, cat] = await Promise.all([
    repo.getSiteSettings(),
    numeric ? findCat(categoryId) : Promise.resolve(null),
  ])
  return {
    // 源站标题 `${name} - ${siteName}`；404 时 `jr(title)` → 「分类不存在 - 彩搜搜」
    title: (cat ? `${cat.name} - ${settings.siteName}` : `分类不存在 - ${settings.siteName}`),
    description: cat ? `${cat.name}分类收录的优质网址导航，快速找到需要的站点` : settings.siteDescription,
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params
  const repo = getContentRepository()
  const numeric = /^\d+$/.test(categoryId || '')
  const cat = numeric ? await findCat(categoryId) : null
  // 源站 categoryId 精确匹配（含子分类的链接不并入父级；如 国际站 183 卡属子分类 → 父级 total 0 空态）。
  // 顺序 = getLinksByCategory 规范序（CAT_ORDER 优先 + 档案序追加，两侧一致）。
  const [links, tags, user] = await Promise.all([
    cat ? repo.getLinksByCategory(cat.id) : Promise.resolve([]),
    repo.getTags(),
    getSessionUser(),
  ])
  const tagsById = Object.fromEntries(tags.map((t) => [t.id, t]))
  return (
    <SiteFrame user={user} barVariant={null}>
      <CatTagView
        mode="category"
        id={categoryId}
        numeric={numeric}
        item={cat ? { name: cat.name, icon: cat.icon } : null}
        links={links}
        tagsById={tagsById}
      />
    </SiteFrame>
  )
}
