const fs = require('fs')
const dir = 'L:/ai-website-cloner-template/docs/research/facai8/api/'
const urls = new Set()
const exts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']

function collect(v) {
  if (typeof v === 'string') {
    if (v.startsWith('/uploads/') || /^https?:\/\/[^ ]*\.(png|jpe?g|webp|gif|svg|avif)/i.test(v)) urls.add(v)
    return
  }
  if (Array.isArray(v)) return v.forEach(collect)
  if (v && typeof v === 'object') return Object.values(v).forEach(collect)
}

let total = 0
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  try {
    const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'))
    const before = urls.size
    collect(j)
    if (urls.size > before) { /* console.log(f, urls.size - before) */ }
    total = urls.size
  } catch (e) { /* ignore */ }
}
console.log('unique image urls:', urls.size)
// 扩展名分布
const byExt = {}
for (const u of urls) {
  const m = u.split('?')[0].match(/\.([a-z0-9]+)$/i)
  const e = m ? m[1].toLowerCase() : '?'
  byExt[e] = (byExt[e] || 0) + 1
}
console.log(byExt)
fs.writeFileSync('L:/ai-website-cloner-template/scripts/facai8/image-urls.txt', [...urls].join('\n'))
console.log('saved to scripts/facai8/image-urls.txt')
