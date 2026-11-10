const fs = require('fs')
async function main() {
  const res = await fetch('https://999.facai8.net/assets/index-B351FioS.css', { signal: AbortSignal.timeout(30000) })
  const t = await res.text()
  fs.writeFileSync('L:/ai-website-cloner-template/docs/research/facai8/app-css.txt', t)
  console.log('bytes:', t.length)
  // 字体栈
  const fams = [...t.matchAll(/font-family:\s*([^;})]+)/g)].map(m => m[1].trim())
  const uniq = [...new Set(fams)]
  console.log('font-families:', uniq.length)
  uniq.slice(0, 15).forEach(f => console.log('  ', f.slice(0, 120)))
  // :root / 变量
  const root = t.match(/:root\s*{([^}]+)}/g)
  if (root) { console.log('--- :root blocks:', root.length); root.slice(0, 4).forEach(b => console.log(b.slice(0, 400))) }
  // 关键类
  for (const cls of ['header-inner', 'header ', 'nav-link', 'link-card', 'cat-section', 'cat-header', 'cat-title', 'sidebar ', 'home-sidebar', 'site-footer', 'bulletin', 'home-banner', 'stats', 'new-link']) {
    const m = t.match(new RegExp('\\.' + cls.trim().split(' ')[0] + '[^{]*\\{[^}]+\\}'))
    if (m) console.log('CLS', cls, '->', m[0].slice(0, 260).replace(/\n/g, ' '))
  }
}
main()
