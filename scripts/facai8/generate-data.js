// 生成 src/lib/facai8/data/*.ts —— 从 docs/research/facai8/api 归档数据
// 用法: node scripts/facai8/generate-data.js
const fs = require('fs')
const path = require('path')
const API = 'L:/ai-website-cloner-template/docs/research/facai8/api/'
const OUT = 'L:/ai-website-cloner-template/src/lib/facai8/data'
fs.mkdirSync(OUT, { recursive: true })

const D = (p) => {
  let t = fs.readFileSync(API + p, 'utf8')
  let j = JSON.parse(t)
  if (typeof j === 'string') j = JSON.parse(j)
  return j.data
}
// 整个信封（popup 等）
const E = (p) => {
  let t = fs.readFileSync(API + p, 'utf8')
  let j = JSON.parse(t)
  if (typeof j === 'string') j = JSON.parse(j)
  return j
}

// 图标库 id -> 哈希（iconfont 项目）
const LIB_HASH = {
  '95067183620689920': '7c7069a52f83',
  '95081863491751936': '29c7690d8048',
  '97222285341102080': 'f2012cca824b',
  '104640322226753536': '3085acd0f743',
  '95049998496043008': '7e7595cf1d30',
}
// "95049998496043008:icon-caishen" -> 'il7e7595cf1d30 iconfont icon-caishen'
const iconClass = (iconUrl) => {
  if (!iconUrl) return ''
  const [lib, name] = String(iconUrl).split(':')
  const hash = LIB_HASH[lib]
  if (!hash || !name) return ''
  return `il${hash} iconfont ${name}`
}
const ic = (v) => JSON.stringify(iconClass(v))

const file = (name, header, body) => {
  const content = body === undefined ? header : header + body + '\n'
  fs.writeFileSync(path.join(OUT, name), content)
  console.log('wrote', name, (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1) + 'KB')
}

// ---- 1. 站点信息 ----
const si = D('site-info.json')
file('site-info.ts', `// 生成自 /api/public/site-info（2026-11-08 存档）\nexport const SITE_INFO = {\n`,
  ['siteName', 'siteDescription', 'siteLogo', 'siteFavicon', 'footerText', 'adsRandom'].map(k => `  ${k}: ${JSON.stringify(si[k])},\n`).join('') + `}\n`)

// ---- 2. 统计 ----
const st = D('stats.json')
file('stats.ts', `// 生成自 /api/public/stats（2026-11-08 存档）\nexport const STATS = {\n`,
  Object.entries(st).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},\n`).join('') + `}\n`)

// ---- 3. 标签 ----
const tags = D('tags.json')
file('tags.ts', `// 生成自 /api/public/tags（2026-11-08 存档）\nexport interface Tag { id: string; name: string; icon: string; color: string; bgColor: string }\nexport const TAGS: Tag[] = ${JSON.stringify(tags.map(t => ({ ...t, icon: iconClass(t.icon) })), null, 1)}\n`)

// ---- 4. 图标库 ----
const libs = D('icon-libraries.json')
file('icon-libraries.ts', `// 生成自 /api/public/icon-libraries；本地字体位于 /sites/facai8/fonts/iconfont-{hash}.*\nexport interface IconLibrary { id: string; prefix: string; hash: string; cssPath: string }\nexport const ICON_LIBRARIES: IconLibrary[] = ${JSON.stringify(libs.map(l => ({ id: l.id, prefix: l.prefix, hash: LIB_HASH[l.id] || '', cssPath: `/sites/facai8/fonts/iconfont-${LIB_HASH[l.id]}.css` })), null, 1)}\n`)

// ---- 5. 网址分类树（60 顶层 + 子分类）----
const cats = D('links.json')
const catTree = cats.map(c => ({
  id: c.id, name: c.name, icon: iconClass(c.iconUrl), sortOrder: c.sortOrder,
  children: (c.children || []).map(ch => ({ id: ch.id, name: ch.name, icon: iconClass(ch.iconUrl), sortOrder: ch.sortOrder }))
}))
file('categories.ts', `// 生成自 /api/categories/links（2026-11-08 存档）；60 个顶层分类，含子分类\nexport interface CatNode { id: string; name: string; icon: string; sortOrder: string; children: { id: string; name: string; icon: string; sortOrder: string }[] }\nexport const LINK_CATEGORIES: CatNode[] = ${JSON.stringify(catTree, null, 1)}\n`)

// ---- 6. 文章分类（5）----
const acats = D('articles.json')
file('article-categories.ts', `// 生成自 /api/categories/articles\nexport interface ArticleCategory { id: string; name: string; icon: string; sortOrder: string }\nexport const ARTICLE_CATEGORIES: ArticleCategory[] = ${JSON.stringify(acats.map(a => ({ id: a.id, name: a.name, icon: iconClass(a.iconUrl), sortOrder: a.sortOrder || '0' })), null, 1)}\n`)

// ---- 7. 全部链接（3791）----
const all = D('all-links.json')
const links = all.map(l => ({
  id: l.id, categoryId: l.categoryId, logoUrl: l.logoUrl || '', url: l.url,
  title: l.title, description: l.description || '', isGone: l.isGone ? 1 : 0, tagId: l.tagId || null
}))
file('links.ts', `// 生成自 /api/public/all-links（2026-11-08 存档，${all.length} 条）\nexport interface LinkItem { id: string; categoryId: string; logoUrl: string; url: string; title: string; description: string; isGone: 0 | 1; tagId: string | null }\nexport const ALL_LINKS: LinkItem[] = ${JSON.stringify(links, null, 1)}\n`,
)
console.log('links entries:', links.length)

// ---- 8. 文章（28 篇全文）----
let det = JSON.parse(fs.readFileSync(API + 'x-all-articles-details.json', 'utf8'))
if (typeof det === 'string') det = JSON.parse(det)
const articles = det.map(envelope => {
  const d = envelope.data || envelope
  return {
  id: d.id, title: d.title, content: d.content || '', coverImage: d.coverImage || '',
  categoryId: d.categoryId, categoryName: d.categoryName,
  seoTitle: d.seoTitle || '', seoKeywords: d.seoKeywords || '', seoDescription: d.seoDescription || '',
  viewCount: d.viewCount ? String(d.viewCount) : '0',
  createdAt: d.createdAt, updatedAt: d.updatedAt || d.createdAt,
  authorName: d.authorName || '', authorAvatar: d.authorAvatar || ''
  };
})
file('articles.ts', `// 生成自 /api/articles/{id} 全量 28 篇（2026-11-08 存档）\nexport interface Article { id: string; title: string; content: string; coverImage: string; categoryId: string; categoryName: string; seoTitle: string; seoKeywords: string; seoDescription: string; viewCount: string; createdAt: string; updatedAt: string; authorName: string; authorAvatar: string }\nexport const ALL_ARTICLES: Article[] = ${JSON.stringify(articles, null, 1)}\n`)

// ---- 9. 广告（14）----
const ads = D('ads.json')
file('ads.ts', `// 生成自 /api/public/ads?position=home（2026-11-08 存档）\nexport interface Ad { id: string; linkUrl: string; imageUrl: string; title: string }\nexport const HOME_ADS: Ad[] = ${JSON.stringify(ads, null, 1)}\n`)

// ---- 10. 线路（5）----
const lines = D('x-lines.json')
file('lines.ts', `// 生成自 /api/public/lines（2026-11-08 存档）\nexport interface SiteLine { id: string; name: string; url: string }\nexport const SITE_LINES: SiteLine[] = ${JSON.stringify(lines, null, 1)}\n`)

// ---- 11. 弹窗 ----
const pop = D('popup.json')
file('popup.ts', `// 生成自 /api/public/popup（2026-11-08 存档）\nexport const HOME_POPUP = {\n`,
  `  enabled: ${JSON.stringify(!!pop.enabled)},\n  title: ${JSON.stringify(pop.title || '')},\n  content: ${JSON.stringify(pop.content || '')}\n}\n`)

// ---- 12. 公告 ----
const bl = D('bulletins.json')
let bdet = JSON.parse(fs.readFileSync(API + 'x-bulletin-detail.json', 'utf8'))
if (typeof bdet === 'string') bdet = JSON.parse(bdet)
const bdata = bdet.data || {}
file('bulletins.ts', `// 生成自 /api/bulletins?page=0 + /api/bulletins/{id}（2026-11-08 存档）\nexport interface Bulletin { id: string; title: string; createdAt: string; content: string }\nexport const BULLETINS: Bulletin[] = ${JSON.stringify(bl.content.map(b => ({ id: b.id, title: b.title, createdAt: b.createdAt, content: b.id === bdata.id ? (bdata.content || '') : '' })), null, 1)}\n`)

// ---- 13. 最新收录 / 最近更新 / 最新文章 ----
const nl = D('new-links.json')
file('new-links.ts', `// 生成自 /api/public/new-links\nexport interface MiniLink { id: string; title: string; logoUrl: string; url: string; categoryName: string }\nexport const NEW_LINKS: MiniLink[] = ${JSON.stringify(nl, null, 1)}\n`)
const rl = D('recent-links.json')
file('recent-links.ts', `// 生成自 /api/public/recent-links\nexport interface MiniLink { id: string; title: string; logoUrl: string; url: string; categoryName: string }\nexport const RECENT_LINKS: MiniLink[] = ${JSON.stringify(rl, null, 1)}\n`)
const na = D('new-articles.json')
file('new-articles.ts', `// 生成自 /api/public/new-articles\nexport interface MiniArticle { id: string; title: string; categoryName: string }\nexport const NEW_ARTICLES: MiniArticle[] = ${JSON.stringify(na, null, 1)}\n`)

console.log('DONE. total files:', fs.readdirSync(OUT).length)
