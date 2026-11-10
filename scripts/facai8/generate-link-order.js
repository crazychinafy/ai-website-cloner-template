// 生成 src/lib/facai8/data/link-order.ts：源站 /api/links?categoryId|tagId 的**卡片顺序快照**（可复跑/可续跑）。
// 背景：源站 /links 端点按其未公开 DB 字段排序，顺序与 /api/public/all-links 不同且返回体无排序字段 → 无法推导，
//   故抓取 /links 各分类/标签的完整 id 序列存档。渲染时按此序列重排（顺序外的 id 保持档案序附后）。
// 约束：源站 Cloudflare 对**高频/并发**请求软限流（返回 200+json 但 content 空）→ 串行 + 2.5s 间隔 + 预热冷却；
//   个别被限流取空的分类/标签 → 留空（该页回退档案序），属快照漂移的预期降级。
import fs from 'fs'

const ROOT = 'L:/ai-website-cloner-template/'
const D = ROOT + 'src/lib/facai8/data/'
const BASE = 'https://999.facai8.net/api'
const MANIFEST = ROOT + 'docs/research/facai8/link-order-manifest.json'
const GAP = 2500 // 串行间隔（毫秒）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArray(file, constName) {
  const s = fs.readFileSync(D + file, 'utf8')
  const anchor = s.indexOf('export const ' + constName)
  const start = s.indexOf('[', anchor)
  const body = s.slice(start, s.lastIndexOf(']') + 1)
  const items = []
  const re = /"id":\s*"([^"]+)"\s*,\s*"name":\s*"([^"]*)"/g
  let m
  while ((m = re.exec(body))) items.push({ id: m[1], name: m[2] })
  return items
}

const cats = parseArray('categories.ts', 'LINK_CATEGORIES')
const tags = parseArray('tags.ts', 'TAGS')

// 续跑清单：已取到顺序的 key → 不重复抓（可断点续跑）
let manifest = {}
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
} catch {}

async function fetchOne(param, id) {
  const key = param + ':' + id
  if (Array.isArray(manifest[key]) && manifest[key].length) return manifest[key] // 已取过
  const ids = []
  let page = 0
  for (;;) {
    let j = null
    for (let a = 0; a < 4; a++) {
      try {
        const r = await fetch(`${BASE}/links?${param}=${id}&page=${page}`)
        const ct = r.headers.get('content-type') || ''
        if (!r.ok || !ct.includes('json')) { await sleep(1500); continue }
        j = await r.json()
        break
      } catch {
        await sleep(1500)
      }
    }
    if (!j || j.code !== 200) break
    const d = j.data || {}
    const content = d.content || []
    ids.push(...content.map((x) => String(x.id)))
    const total = d.totalElements ?? d.total ?? content.length
    if (content.length === 0 && ids.length === 0 && page === 0 && total > 0) {
      // 疑似软限流（应非空却空）→ 拉长等待后整页重试一次
      await sleep(4000)
      const r2 = await fetch(`${BASE}/links?${param}=${id}&page=0`)
      const j2 = await r2.json()
      const c2 = (j2.data && j2.data.content) || []
      if (c2.length) { ids.length = 0; ids.push(...c2.map((x) => String(x.id))) } else break
    }
    if (content.length < (d.size || 54) || ids.length >= total || page > 60) break
    page++
    await sleep(GAP)
  }
  manifest[key] = ids
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  return ids
}

// 预热：确保 IP 未被限流（用已知非空的 U站 探测；取空则冷却等待）
async function warmUp() {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(`${BASE}/links?tagId=93213176027549696&page=0`)
      const j = await r.json()
      const n = (j.data && j.data.content) || []
      if (n.length) { console.log('warmup ok', n.length); return }
    } catch {}
    console.log('warmup throttle, cool 15s...')
    await sleep(15000)
  }
}

console.log('parsed cats:', cats.length, 'tags:', tags.length, '| manifest already has', Object.keys(manifest).length)
await warmUp()

const CAT_ORDER = {}
const TAG_ORDER = {}

for (const c of cats) {
  const ids = await fetchOne('categoryId', c.id)
  if (ids.length) CAT_ORDER[c.id] = ids
  await sleep(GAP)
}
for (const t of tags) {
  const ids = await fetchOne('tagId', t.id)
  if (ids.length) TAG_ORDER[t.id] = ids
  await sleep(GAP)
}

const out = []
out.push('// 生成自源站 /api/links?categoryId|tagId（`node scripts/facai8/generate-link-order.js`；勿手改，重跑覆盖）')
out.push('// 源站该端点按其未公开 DB 字段排序，顺序与 /api/public/all-links 不同且返回体无排序字段 → 无法推导，故存档当前 id 序列。')
out.push('// 渲染时按此序列重排（顺序外的 id 保持档案序附后）；快照随源站漂移属预期，个别被限流取空的分类/标签回退档案序。')
out.push('export const CAT_ORDER: Record<string, string[]> = {')
for (const [id, ids] of Object.entries(CAT_ORDER)) out.push(`  "${id}": [${ids.map((x) => `"${x}"`).join(', ')}],`)
out.push('}')
out.push('')
out.push('export const TAG_ORDER: Record<string, string[]> = {')
for (const [id, ids] of Object.entries(TAG_ORDER)) out.push(`  "${id}": [${ids.map((x) => `"${x}"`).join(', ')}],`)
out.push('}')
out.push('')
out.push('/** 按存档序列重排（未知 id 保持档案序附后；无序列 → 原样） */')
out.push('export function applyLinkOrder<T extends { id: string }>(links: T[], order?: string[]): T[] {')
out.push('  if (!order || order.length === 0) return links')
out.push('  const rank = new Map<string, number>()')
out.push('  order.forEach((id, i) => rank.set(id, i))')
out.push('  return [...links].sort((a, b) => {')
out.push('    const ra = rank.get(a.id)')
out.push('    const rb = rank.get(b.id)')
out.push('    if (ra === undefined && rb === undefined) return 0')
out.push('    if (ra === undefined) return 1')
out.push('    if (rb === undefined) return -1')
out.push('    return ra - rb')
out.push('  })')
out.push('}')
fs.writeFileSync(D + 'link-order.ts', out.join('\n'))
console.log('DONE written', D + 'link-order.ts', out.join('\n').length, 'bytes | cats', Object.keys(CAT_ORDER).length, '/', cats.length, 'tags', Object.keys(TAG_ORDER).length, '/', tags.length)
