// 彩搜搜站点公共工具：素材路径映射、数字/日期格式化、搜索
import { ALL_LINKS, type LinkItem } from './data/links'
import { ALL_ARTICLES, type Article } from './data/articles'
import { LINK_CATEGORIES } from './data/categories'
import { LINK_DETAILS } from './data/link-details'
import { LINK_MIRRORS, type LinkMirror } from './data/link-mirrors'
import { TAGS, type Tag } from './data/tags'
import { SEARCH_DESCRIPTIONS } from './data/searchDescriptions'

/** 源站 /uploads/... 素材 → 本地 public/sites/facai8/images/{原文件名} */
export function asset(p: string | null | undefined): string | null {
  if (!p) return null
  if (p.startsWith('http')) return p
  const base = decodeURIComponent(p.split('/').pop() || '')
  if (!base) return null
  return `/sites/facai8/images/${base}`
}

/** 无 Logo 站点时源站使用的 Google favicon 服务 */
export function gstaticFavicon(url: string): string {
  return `https://t0.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=${encodeURIComponent(url)}`
}

/** 3791 → 3.8K；146779 → 146.8K；999 → 999 */
export function fmtK(n: number | string): string {
  const v = typeof n === 'string' ? parseInt(n, 10) : n
  if (isNaN(v)) return String(n)
  if (v < 1000) return String(v)
  const k = (v / 1000).toFixed(1)
  return (k.endsWith('.0') ? k.slice(0, -2) : k) + 'K'
}

/** 2026-11-07T15:17:07 → 2026/11/7（列表/元信息用） */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return String(iso).slice(0, 10)
  return `${+m[1]}/${+m[2]}/${+m[3]}`
}

/** 2026-11-07 → 2026年11月7日（文章详情用） */
export function fmtDateCn(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return String(iso).slice(0, 10)
  return `${+m[1]}年${+m[2]}月${+m[3]}日`
}

/** 公告日期 MM-DD */
export function fmtDateMD(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return ''
  return `${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 首字符（头像/Logo 回退用；中文取第一字） */
export function firstChar(s: string | null | undefined): string {
  if (!s) return '?'
  const c = Array.from(s.trim())[0] || '?'
  return c
}

// ---------------- 站内搜索（数据即源站 /api/public/search 的本地等价） ----------------

export interface SearchLinkResult extends LinkItem {
  categoryName: string
}
export interface SearchArticleResult {
  id: string
  title: string
  categoryName: string
  description: string
  createdAt: string
}

const highlight = (s: string, q: string) => {
  if (!q || !s) return s
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return s.replace(new RegExp(esc, 'gi'), '<mark class="srch-mark">$&</mark>')
  } catch {
    return s
  }
}

// 分类 id → 名称（顶层 + 子分类；源站搜索结果展示 categoryName）
const CAT_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const c of LINK_CATEGORIES) {
    m[c.id] = c.name
    for (const sub of c.children) m[sub.id] = sub.name
  }
  return m
})()

/** 搜索链接（本地实现，等价源站 type=link：title/description 匹配，不含 URL——源站实测 666d.com 0 条） */
export function searchLinks(q: string): SearchLinkResult[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return ALL_LINKS.filter(
    (l) => l.title.toLowerCase().includes(s) || l.description.toLowerCase().includes(s)
  ).map((l) => ({ ...l, categoryName: CAT_NAME[l.categoryId] || '' }))
}

/** 文章正文 → 搜索摘要：源站后端去标签（不压空白，换行原样保留），>100 取前 100 + 「…」 */
export function articleExcerpt(html: string): string {
  const s = String(html || '').replace(/<[^>]+>/g, '')
  return s.length > 100 ? s.slice(0, 100) + '…' : s
}

/** 搜索文章（本地实现，等价源站 type=article：title/content 匹配，不含 categoryName——源站实测 黑平台 6 条）
 *  description 优先用源站搜索接口快照（索引按条目时间混存新旧截断逻辑，单一规则不可复现），缺失时回退本地规则 */
export function searchArticles(q: string): SearchArticleResult[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return ALL_ARTICLES.filter(
    (a) => a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s)
  ).map((a) => ({
    id: a.id,
    title: a.title,
    categoryName: a.categoryName,
    description: SEARCH_DESCRIPTIONS[a.id] ?? articleExcerpt(a.content),
    createdAt: a.createdAt,
  }))
}

export { highlight as hl }

// ---------------- 文章详情辅助 ----------------

/** 富文本中 /uploads/ 图片映射到本地（其余原样保留） */
export function localHtml(html: string): string {
  return html.replace(/(src=")(\/uploads\/[^"]+)/g, (_, p1: string, p2: string) => {
    const a = asset(p2)
    return a ? p1 + a : _
  })
}

/** 链接点击数（link-details 存档；无数据 = 0） */
export function linkClicks(l: LinkItem): number {
  const d = LINK_DETAILS[l.id]
  return d ? parseInt(d.clickCount, 10) || 0 : 0
}

/**
 * 文章详情的「相关网址」：源站规则 = 链接标题（≥2 字符、未失效）与文章标题互为子串（忽略大小写），
 * 同名去重后按点击数取 1 条；无匹配则不渲染该侧栏。
 */
export function relatedLinksForArticle(a: Article): LinkItem[] {
  const t = a.title.trim().toLowerCase()
  if (!t) return []
  const best = new Map<string, LinkItem>()
  for (const l of ALL_LINKS) {
    if (l.isGone === 1) continue
    const lt = l.title.trim().toLowerCase()
    if (lt.length < 2) continue
    if (t.includes(lt) || lt.includes(t)) {
      const prev = best.get(lt)
      if (!prev || linkClicks(l) > linkClicks(prev)) best.set(lt, l)
    }
  }
  return [...best.values()].sort((x, y) => linkClicks(y) - linkClicks(x)).slice(0, 1)
}

// ---------------- 站点详情辅助 ----------------

/** 源站 Zr：URL 显示文本（协议 + host；无法解析时原样） */
export function displayUrl(url: string): string {
  const m = String(url || '').match(/^https?:\/\/[^/?#]+/i)
  return m ? m[0] : String(url || '')
}

/**
 * 站点详情的「相关文章」：源站规则镜像 = 文章标题与链接标题互为子串（忽略大小写、均 ≥2 字符），
 * 按文章标题去重、createdAt 降序，最多 10 条（源站侧栏 pageSize=10）；无匹配则不渲染该侧栏。
 */
export function relatedArticlesForLink(l: LinkItem): Article[] {
  const lt = l.title.trim().toLowerCase()
  if (lt.length < 2) return []
  const best = new Map<string, Article>()
  for (const a of ALL_ARTICLES) {
    const at = a.title.trim().toLowerCase()
    if (at.length < 2) continue
    if (at.includes(lt) || lt.includes(at)) {
      if (!best.has(at)) best.set(at, a)
    }
  }
  return [...best.values()]
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
    .slice(0, 10)
}

/** 备用域名（源站子集功能；无数据不渲染备用链接区） */
export function mirrorsForLink(id: string): LinkMirror[] {
  return LINK_MIRRORS[id] || []
}

/** 标签徽章（link-head 右侧彩色徽章用） */
export function tagById(id: string | null | undefined): Tag | null {
  if (!id) return null
  return TAGS.find((t) => t.id === id) || null
}
