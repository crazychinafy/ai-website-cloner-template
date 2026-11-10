// 下载源站字体文件到本地
const fs = require('fs')
const path = require('path')
const BASE = 'https://999.facai8.net'
const hashes = ['7c7069a52f83', '29c7690d8048', 'f2012cca824b', '3085acd0f743', '7e7595cf1d30']
const outDir = 'L:/ai-website-cloner-template/public/sites/facai8/fonts'
fs.mkdirSync(outDir, { recursive: true })

async function main() {
  for (const h of hashes) {
    for (const ext of ['woff2', 'woff', 'ttf']) {
      const url = `${BASE}/uploads/fonts/${h}/iconfont.${ext}`
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!res.ok) { console.log(h, ext, 'HTTP', res.status); continue }
        const buf = Buffer.from(await res.arrayBuffer())
        const ct = res.headers.get('content-type')
        const dest = path.join(outDir, `iconfont-${h}.${ext}`)
        fs.writeFileSync(dest, buf)
        console.log(h, ext, ct, (buf.length / 1024).toFixed(1) + 'KB')
      } catch (e) { console.log(h, ext, 'ERR', e.message) }
    }
  }
}
main()
