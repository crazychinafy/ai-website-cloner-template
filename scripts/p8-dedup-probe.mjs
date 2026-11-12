// P8-7 取证：一次前台请求在 MySQL 侧的 SELECT 清单（performance_schema.events_statements_history_long 采样）。
// 证明 React.cache 请求级去重生效：同一方法（如 getSiteSettings 被 layout generateMetadata +
// Header/SiteFooter + 页面多处调用）在一次请求内只产生 1 条 SQL；跨请求不复用（第二次请求重新查询）。
// 用法: node scripts/p8-dedup-probe.mjs <url> [db=facai8_p8_test]
import mysql from 'mysql2/promise'

const url = process.argv[2] || 'http://127.0.0.1:3112/'
const db = process.argv[3] || 'facai8_p8_test'

const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: process.env.DB_PASSWORD || 'root123456',
})

async function enableHistoryLong() {
  await conn.query(
    "UPDATE performance_schema.setup_consumers SET ENABLED='YES' WHERE NAME='events_statements_history_long'"
  )
  const [rows] = await conn.query(
    "SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME='events_statements_history_long'"
  )
  if (String(rows[0]?.ENABLED) !== 'YES') throw new Error('events_statements_history_long 无法启用')
}

// 预热（冷启动首请求可能触发额外编译/首次查询）
await fetch(url)

async function sample(label) {
  await enableHistoryLong()
  await conn.query('TRUNCATE TABLE performance_schema.events_statements_history_long')
  const res = await fetch(url)
  const body = await res.text()
  const [rows] = await conn.query(
    `SELECT SQL_TEXT AS argument FROM performance_schema.events_statements_history_long
     WHERE CURRENT_SCHEMA = ? AND SQL_TEXT LIKE 'SELECT%' ORDER BY TIMER_START`,
    [db]
  )
  const selects = rows.map((r) => String(r.argument))
  const byTable = new Map()
  for (const s of selects) {
    const m = s.match(/FROM\s+`?([a-z0-9_]+)`?/i)
    const t = m ? m[1] : '?'
    byTable.set(t, (byTable.get(t) || 0) + 1)
  }
  console.log(`\n== ${label} (${res.status}, ${body.length}B) SELECTs=${selects.length}`)
  for (const [t, n] of [...byTable.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`)
  }
  const norm = (s) => s.replace(/\/\*.*?\*\//g, '').replace(/\s+/g, ' ').trim()
  const dup = selects.length - new Set(selects.map(norm)).size
  console.log(`  duplicate_textual_selects=${dup}`)
  return { selects, byTable }
}

const r1 = await sample('request#1')
const r2 = await sample('request#2 (fresh request scope)')

await conn.query(
  "UPDATE performance_schema.setup_consumers SET ENABLED='NO' WHERE NAME='events_statements_history_long'"
)

const settings1 = r1.byTable.get('site_settings') ?? 0
const settings2 = r2.byTable.get('site_settings') ?? 0
console.log(
  `\nRESULT: site_settings selects per request: #1=${settings1} #2=${settings2}` +
    ' (page+layout+metadata 多处调用 → 期望各=1 = 请求内去重生效; 两次请求都有 = 跨请求不共享)'
)

await conn.end()
