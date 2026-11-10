// 下载源站全部图片素材到 public/sites/facai8/images/
// 用法: node download-images.js [并发数] [起始偏移] [结束偏移]
const fs = require('fs')
const path = require('path')
const BASE = 'https://999.facai8.net'
const OUT = 'L:/ai-website-cloner-template/public/sites/facai8/images'
const CONC = parseInt(process.argv[2] || '10', 10)
const START = parseInt(process.argv[3] || '0', 10)
const END = parseInt(process.argv[4] || '0', 10) || Infinity

const ok = new Set()
const failed = []

async function downloadOne(u) {
  let full = u.startsWith('http') ? u : BASE + u
  const name = decodeURIComponent(u.split('?')[0].split('/').pop())
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) return false
  if (ok.has(name)) return true
  try {
    const res = await fetch(full, { signal: AbortSignal.timeout(25000) })
    if (!res.ok) { failed.push(u + ' HTTP' + res.status); return false }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!/image|octet-stream/.test(ct)) { failed.push(u + ' CT:' + ct); return false }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(OUT, name), buf)
    ok.add(name)
    return true
  } catch (e) { failed.push(u + ' ' + e.message); return false }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const urls = fs.readFileSync('L:/ai-website-cloner-template/scripts/facai8/image-urls.txt', 'utf8').split('\n').filter(Boolean).filter(u => !u.endsWith('.css'))
  const total = urls.length
  console.log(`total ${total}, concurrency ${CONC}, range ${START}-${Math.min(END, total)}`)
  let i = START
  let done = 0
  async function worker() {
    while (i < total && i < END) {
      const idx = i++
      const u = urls[idx]
      if (await downloadOne(u)) done++
      if (done % 200 === 0) console.log(`progress ${idx + 1}/${total} ok=${ok.size} failed=${failed.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
  fs.writeFileSync(path.join(OUT, '..', 'download-report.json'), { ok: [...ok], failed, total })
  console.log(`DONE ok=${ok.size} failed=${failed.length}`)
  if (failed.length) console.log('failed sample:', failed.slice(0, 10).join('\n'))
}
main().catch(e => { console.error(e); process.exit(1) })
