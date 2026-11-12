// P8 调查探针：404 路由 head 中 <link rel="preload"> 差异是否 = 流式解析计时产物（与数据源无关）
// 用法: node scripts/p8-404-preload-probe.mjs <urlA> <urlB> [path]
const [baseA, baseB, p = '/link/109625874986438656'] = process.argv.slice(2)

async function fetchInfo(base, path) {
  const r = await fetch(base + path)
  const t = await r.text()
  const head = t.slice(0, t.indexOf('</head>'))
  const preloads = [...head.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0])
  const styles = [...head.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((m) => m[0])
  // 可见正文（剥掉所有 <script>…</script> 后 main/body 文本）
  const noScript = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  const text = noScript.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return { status: r.status, preloads, styles, textLen: text.length, textHead: text.slice(0, 120) }
}

for (const [name, base] of [['A(static)', baseA], ['B(mysql)', baseB]]) {
  console.log(`\n== ${name} ${base}${p} ==`)
  for (let i = 0; i < 3; i++) {
    const x = await fetchInfo(base, p)
    console.log(`req${i + 1} status=${x.status} preloads=${x.preloads.length} styles=${x.styles.length} textLen=${x.textLen}`)
    console.log(`  text=${x.textHead}`)
    for (const pl of x.preloads) console.log(`  PL: ${pl.slice(0, 100)}`)
  }
}
const a = await fetchInfo(baseA, p)
const b = await fetchInfo(baseB, p)
console.log(`\nvisible-text-equal=${a.text === b.text} status-equal=${a.status === b.status} styles-equal=${JSON.stringify(a.styles) === JSON.stringify(b.styles)}`)
