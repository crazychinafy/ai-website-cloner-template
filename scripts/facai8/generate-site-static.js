// 生成 src/lib/facai8/data/site-static.ts：4 个静态页（/about /disclaimer /agreement /privacy）正文
// 数据来源：Observe 期源站渲染 DOM 存档（dom-about.json / dom-static-{disclaimer,agreement,privacy}.json）
//   —— 该 DOM 已是源站 DOMPurify 净化 + 图片宽高注入（Tn）后的**终态**，直接存档即 1:1。
// 源站行为（SiteInfoPage-DKfpo35q.js 基座）：客户端 GET /api/public/site-info/{field} 取 HTML →
//   骨架屏 → 净化渲染 .sip-card.article-detail-content。本地 = SSR 直出终态（内容静态，无 loading/error 分支，
//   4 个正文均无 <img>，源站图片宽高注入逻辑不会触发）。
import fs from 'fs'
import path from 'path'

const ROOT = 'L:/ai-website-cloner-template'
const D = ROOT + '/docs/research/facai8/'
const OUT = ROOT + '/src/lib/facai8/data/site-static.ts'

const PAGES = [
  { field: 'aboutUs', route: 'about', domFile: 'dom-about.json', jsonWrapped: true },
  { field: 'disclaimer', route: 'disclaimer', domFile: 'dom-static-disclaimer.json', jsonWrapped: false },
  { field: 'agreement', route: 'agreement', domFile: 'dom-static-agreement.json', jsonWrapped: false },
  { field: 'privacy', route: 'privacy', domFile: 'dom-static-privacy.json', jsonWrapped: false },
]

function loadDom(file, jsonWrapped) {
  let s = fs.readFileSync(D + file, 'utf8')
  if (jsonWrapped) s = JSON.parse(s)
  return s
}

function extract(html, name) {
  const title = (html.match(/<h1 class="sip-title">([^<]*)<\/h1>/) || [])[1]
  const subtitle = (html.match(/<p class="sip-subtitle">([^<]*)<\/p>/) || [])[1]
  const card = '<div class="sip-card article-detail-content">'
  const i = html.indexOf(card)
  if (i < 0) throw new Error('no sip-card in ' + name)
  // sip-card 是 .site-info-page 的最后一个子级 → 正文 = 卡片开标签后 ~ 末尾 `</div></div>` 前（卡 + 页两收）
  const trimmed = html.replace(/\s+$/, '')
  if (!trimmed.endsWith('</div></div>')) throw new Error('unexpected tail (no card+page closing pair) in ' + name)
  const body = trimmed.slice(i + card.length, trimmed.length - '</div></div>'.length)
  const nestedDivs = (body.match(/<div/g) || []).length
  if (nestedDivs) console.log('  note: body contains', nestedDivs, 'nested <div (balanced, tail-slice 仍安全)')
  return { title, subtitle, body }
}

const out = []
out.push('// 生成自源站渲染 DOM 存档（`node scripts/facai8/generate-site-static.js`；勿手改，重跑覆盖）')
out.push('// 源站 = 客户端 GET /api/public/site-info/{field} + DOMPurify 净化 + 图片宽高注入（Tn）；')
out.push('// 4 个正文均无 <img> → 本地直接 SSR 终态（骨架屏/错误重试/ boot loader 为源站取数态，本地静态无此态）')
out.push('// title/subtitle 与源站 SiteInfoPage props 逐字符一致（About/Disclaimer/Privacy/Agreement chunk）')
out.push('export type StaticField = \'aboutUs\' | \'disclaimer\' | \'privacy\' | \'agreement\'')
out.push('')
out.push('export const SITE_STATIC: Record<StaticField, { title: string; subtitle: string; html: string }> = {')
for (const p of PAGES) {
  const html = loadDom(p.domFile, p.jsonWrapped)
  const { title, subtitle, body } = extract(html, p.domFile)
  if (!title || !subtitle) throw new Error(`missing title/subtitle in ${p.domFile}`)
  out.push(`  ${p.field}: { title: ${JSON.stringify(title)}, subtitle: ${JSON.stringify(subtitle)}, html: ${JSON.stringify(body)} },`)
  console.log(p.route, '→', title, '|', subtitle, '| body', body.length, 'chars, imgs=', (body.match(/<img/g) || []).length)
}
out.push('}')
out.push('')
fs.writeFileSync(OUT, out.join('\n'))
console.log('written', OUT, out.join('\n').length, 'bytes')

// ── 附：存档源站 4 端点原始响应（api/public/site-info/{field}），供与渲染 DOM 正文比对 ──
const apiDir = D + 'api/'
for (const f of ['about', 'disclaimer', 'privacy', 'agreement']) {
  const dest = apiDir + `x-site-info-${f}.json`
  if (fs.existsSync(dest)) { console.log('skip', f, '(exists)'); continue }
  try {
    const r = await fetch('https://999.facai8.net/api/public/site-info/' + f)
    const j = await r.json()
    fs.writeFileSync(dest, JSON.stringify(j, null, 2))
    console.log('archived', f, 'status', r.status, 'data', typeof j.data, j.data ? String(j.data).length + ' chars' : '')
  } catch (e) {
    console.error('fetch', f, 'FAILED:', e.message)
  }
}
