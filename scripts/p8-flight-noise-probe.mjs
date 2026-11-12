// P8-3 取证：static 模式同一 URL 连续两次请求（同进程同构建），
// 若渲染 HTML（含 RSC flight payload）逐位一致，则 flight 差异与数据源无关的假设可被排除/证实。
const [, , base, p1, p2] = process.argv
const norm = (s) => s.replace(/nonce="[^"]*"/g, 'nonce=""')
const get = async (u) => norm(await (await fetch(u)).text())
const a1 = await get(base + p1)
const a2 = await get(base + p1)
const b1 = await get(base + p2)
console.log(`same-url-twice equal=${a1 === a2} len=${a1.length}/${a2.length}`)
if (a1 !== a2) {
  let i = 0
  while (i < a1.length && a1[i] === a2[i]) i++
  console.log(`self-diff@${i}:\n  r1: ${a1.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, ' ')}\n  r2: ${a2.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, ' ')}`)
}
console.log(`other-url len=${b1.length}`)
