// P8-3 双模渲染对比：同一构建分别以 CONTENT_SOURCE=static / mysql 提供服务时，
// 前台页面渲染 HTML 必须逐字节一致（剥离 Next 每次请求随机注入的 nonce 后比较）。
// 用法: node scripts/p8-dual-render-check.mjs <staticBase> <mysqlBase> <path> [<path> ...]
const [, , baseA, baseB, ...paths] = process.argv

function normalize(html) {
  return html
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/"next\/layout":\{[^}]*\}/g, '"next/layout":{}')
    // Next 的 head <link rel="preload"> 资源提示注入：属性顺序不稳定、集合与位置随组件异步解析
    // 时序抖动（static=微任务即决 / mysql=IO 后决；body 内 <img> 集合两侧实测一致）→ 从字节对比中
    // 移除，图片 preload 单独以 preloadImages 指标度量。取证：p8-link404-probe / p8-flight-noise-probe /
    // p8-404-preload-probe（给静态 layout metadata 注入 30ms 延迟 → 静态侧同样发出 3 条 CSS preload）。
    .replace(/<link rel="preload"[^>]*\/>/g, '')
    // 未决 Suspense 边界占位（<div hidden><!--$?--><template id="B:n">…）：React 流式协议脚手架，
    // 浏览器最终 DOM 中消失；shell-flush 与段解析的相对时序随数据源 IO 抖动（static=即决内联 /
    // mysql=IO 后决流出）→ 归一。late-metadata 注入器（$RB=[];…<script>）已被脚本折叠规则覆盖。
    // 取证：p8-404-preload-probe（/link/abc 两侧最终可见文本与 title 完全一致，仅流形态不同）。
    .replace(/<div hidden=""><!--\$\?--><template id="B:\d+"><\/template><!--\/\$--><\/div>/g, '')
}

// 可见 DOM（剥离 hydration flight <script> 段）：flight payload 的分段键序受 Promise 解析
// 时序影响（static=微任务即决 / mysql=IO 后决），同构建同数据源两次请求逐位一致，
// 跨数据源仅段序/段数抖动、内容相同（取证：scripts/p8-flight-noise-probe.mjs、
// scripts/p8-link404-probe.mjs）→ 逐字节对比限定在可见 DOM，flight 段单独度量。
function visibleDom(html) {
  const doc = normalize(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '<SCRIPT/>')
    // 相邻 flight 段合并：段数（chunk 切分点）随异步解析时序抖动，非内容差异
    .replace(/(?:<SCRIPT\/>)+/g, '<SCRIPTS/>')
  // metadata 位置归一：layout metadata 为 async（repo.getSiteSettings）时，Next 可能把
  // title/meta/icon 随独立段在 </head><body> 之后流出（shell 先冲刷），React 运行时再收养进
  // <head>；同步即决侧则直接内联在 head。两侧浏览器最终 head 完全一致 → 把这些标签从全文
  // 抽出为排序集合（单独等值比较），文档字节对比剔除位置因素。
  // 取证：p8-404-preload-probe（/link/abc 两侧最终可见文本与 title 完全一致，仅流形态不同）。
  const tags = [
    ...doc.matchAll(
      /<title>[^<]*<\/title>|<meta\b[^>]*\/>|<link rel="(?:icon|canonical|alternate|manifest)"[^>]*\/>/g
    ),
  ].map((m) => m[0])
  let out = doc
  for (const t of tags) out = out.replace(t, '')
  // 抽走 metadata / 折叠脚本后，流式协议容器（已收养为空的 <div hidden>、含已解析边界注释
  // <!--$--><!--/$--> 的占位 div）与多余相邻 <SCRIPTS/> 段成为唯一残留 → 归一（浏览器最终 DOM 中消失）。
  out = out
    .replace(
      /<div hidden[^>]*>(?:(?:<SCRIPTS?\/>?|<!--\$-->|<!--\/\$-->|\s)*)*<\/div>/g,
      ''
    )
    .replace(/(?:<SCRIPT\/>)+/g, '<SCRIPTS/>')
    .replace(/(?:<SCRIPTS\/>)+/g, '<SCRIPTS/>')
  return { doc: out, meta: tags.sort().join('') }
}

function metrics(html) {
  const count = (re) => (html.match(re) || []).length
  return {
    linkCards: count(/class="link-card"/g),
    bulletins: count(/class="bulletin-item"/g),
    ads: count(/class="home-banner-link"/g),
    railNew: count(/class="new-tag">NEW/g),
    pageBtns: count(/class="srch-page-btn"/g),
    heroTitle: (html.match(/catpage-hero-title-text">([^<]*)/) || [])[1] ?? null,
    heroCount: (html.match(/catpage-hero-count">\s*共 <b>(\d+)/) || [])[1] ?? null,
    totalLabel: (html.match(/共 <b>(\d+)</) || [])[1] ?? null,
    // 内容级图片指标：body 内 <img> 集合（可见渲染的真实图片内容）
    bodyImgs: [...html.slice(html.indexOf('</head>')).matchAll(/<img[^>]*src="([^"]*)"/g)]
      .map((m) => m[1])
      .sort()
      .join(','),
  }
}

let bad = 0
for (const p of paths) {
  const [ra, rb] = [await fetch(baseA + p), await fetch(baseB + p)]
  const [ha, hb] = [await ra.text(), await rb.text()]
  const [va, vb] = [visibleDom(ha), visibleDom(hb)]
  const [na, nb] = [va.doc, vb.doc]
  const [fa, fb] = [normalize(ha), normalize(hb)]
  const [ma, mb] = [metrics(ha), metrics(hb)]
  const same =
    na === nb && va.meta === vb.meta && ra.status === rb.status && ma.bodyImgs === mb.bodyImgs
  if (!same) bad++
  let firstDiff = ''
  if (na !== nb) {
    let i = 0
    while (i < na.length && i < nb.length && na[i] === nb[i]) i++
    firstDiff =
      `\n    A@${i}: ${na.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, ' ')}` +
      `\n    B@${i}: ${nb.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, ' ')}`
  }
  if (va.meta !== vb.meta) {
    firstDiff +=
      `\n    A meta: ${va.meta}` +
      `\n    B meta: ${vb.meta}`
  }
  const scriptCount = (h) => (h.match(/<script/g) || []).length
  console.log(
    `${same ? 'MATCH' : 'DIFF '} ${ra.status}/${rb.status} ${p}` +
      `\n    A cards=${ma.linkCards} bulletins=${ma.bulletins} ads=${ma.ads} new=${ma.railNew} hero=${ma.heroTitle ?? '-'} count=${ma.heroCount ?? ma.totalLabel ?? '-'} imgs=${ma.bodyImgs ? ma.bodyImgs.split(',').length : 0} scripts=${scriptCount(ha)} rawLen=${fa.length}` +
      `\n    B cards=${mb.linkCards} bulletins=${mb.bulletins} ads=${mb.ads} new=${mb.railNew} hero=${mb.heroTitle ?? '-'} count=${mb.heroCount ?? mb.totalLabel ?? '-'} imgs=${mb.bodyImgs ? mb.bodyImgs.split(',').length : 0} scripts=${scriptCount(hb)} rawLen=${fb.length}` +
      firstDiff
  )
}
console.log(bad === 0 ? `ALL_MATCH paths=${paths.length}` : `MISMATCHES=${bad}/${paths.length}`)
process.exit(bad === 0 ? 0 : 1)
