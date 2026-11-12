// 彩搜搜站点公共工具（P8-5 拆分后仅剩纯函数，客户端安全）：素材路径映射、数字/日期格式化、高亮、摘要。
// 数据支撑函数（searchLinks/searchArticles/linkClicks/相关推荐/mirrorsForLink/tagById）已拆到
// ./util-static-data.ts —— 本模块被 Client Component 值导入，绝不导入 data/*，
// 避免静态档案被打进客户端 JS bundle。
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

const highlight = (s: string, q: string) => {
  if (!q || !s) return s
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return s.replace(new RegExp(esc, 'gi'), '<mark class="srch-mark">$&</mark>')
  } catch {
    return s
  }
}

/** 文章正文 → 搜索摘要：源站后端去标签（不压空白，换行原样保留），>100 取前 100 + 「…」 */
export function articleExcerpt(html: string): string {
  const s = String(html || '').replace(/<[^>]+>/g, '')
  return s.length > 100 ? s.slice(0, 100) + '…' : s
}

export { highlight as hl }

// ---------------- 站点详情辅助 ----------------

/** 源站 Zr：URL 显示文本（协议 + host；无法解析时原样） */
export function displayUrl(url: string): string {
  const m = String(url || '').match(/^https?:\/\/[^/?#]+/i)
  return m ? m[0] : String(url || '')
}

/** 富文本中 /uploads/ 图片映射到本地（其余原样保留） */
export function localHtml(html: string): string {
  return html.replace(/(src=")(\/uploads\/[^"]+)/g, (_, p1: string, p2: string) => {
    const a = asset(p2)
    return a ? p1 + a : _
  })
}
