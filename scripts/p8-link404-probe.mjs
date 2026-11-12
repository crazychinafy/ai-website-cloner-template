// P8 取证：对比 /link/abc（404）两模式下的 <script> 标签清单，定位多出的那一个。
const [, , pa] = process.argv
const path = pa ?? '/link/abc'
const get = async (b) => (await (await fetch(b + path)).text())
const a = await get('http://127.0.0.1:3111')
const b = await get('http://127.0.0.1:3112')
const describe = (html) =>
  (html.match(/<script[^>]*>/g) ?? []).map((t, i) => {
    const src = (t.match(/src="([^"]*)"/) ?? [])[1]
    if (src) return `${i} src=${src}`
    const crosssrc = (t.match(/crossorigin="([^"]*)"/) ?? [])[1]
    const inner = (html.split(t)[1] ?? '').slice(0, 90).replace(/\s+/g, ' ')
    return `${i} inline${crosssrc ? ` crossorigin=${crosssrc}` : ''} :: ${inner}`
  })
console.log('--- static(3111)')
describe(a).forEach((l) => console.log(l))
console.log('--- mysql(3112)')
describe(b).forEach((l) => console.log(l))
