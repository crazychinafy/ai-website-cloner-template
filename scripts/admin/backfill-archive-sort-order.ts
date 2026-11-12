// P8：site_links.archive_sort_order 回填（migration 0007 新增列的一次性数据修复）。
// 规则（与导入器同一合同，见 content/repository.ts 可见性/规范序契约）：
//   - 快照内链接：rank = ALL_LINKS 冻结源数组全局下标（0..n-1），首页分组与搜索候选序的规范序；
//   - 快照外链接（后台新建，不在冻结源中）：保持 NULL → 前台首页/搜索按 id 序附尾；
//   - 不触 version/updated_at（排序元数据修复，不参与乐观锁）。
// 默认 dry-run，必须显式 --execute 才写库。
// 用法：
//   DB_USER=... DB_PASSWORD=... DB_NAME=facai8_admin node scripts/admin/backfill-archive-sort-order.ts [--execute]
import mysql from "mysql2/promise"
import { ALL_LINKS } from "../../src/lib/facai8/data/links.ts"

const execute = process.argv.includes("--execute")
const creds = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "facai8_admin",
  user: process.env.DB_USER ?? "facai8_app",
  password: process.env.DB_PASSWORD ?? "",
}

const ranks = new Map<string, number>(ALL_LINKS.map((l, i) => [l.id, i]))

// supportBigNumber*：BIGINT 以精确字符串返回（雪花 ID 超出 JS 安全整数，默认会精度损毁）
// async main 包装（不用顶层 await：tsx 在 cjs 转译下不支持）
async function main() {
const pool = await mysql.createPool({ ...creds, charset: "UTF8MB4_UNICODE_CI", connectionLimit: 2, supportBigNumbers: true, bigNumberStrings: true })
try {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, archive_sort_order FROM site_links WHERE id IN (?)",
    [ALL_LINKS.map((l) => l.id)],
  )
  const plan: { id: string; rank: number; changed: boolean }[] = []
  for (const row of rows) {
    const id = String(row.id)
    const rank = ranks.get(id)
    if (rank === undefined) continue
    const current = row.archive_sort_order === null ? null : Number(row.archive_sort_order)
    plan.push({ id, rank, changed: current !== rank })
  }
  const changes = plan.filter((p) => p.changed)
  console.log(
    `快照链接档案 ${ALL_LINKS.length} 条，库中命中 ${plan.length} 行，需写入 ${changes.length} 行 @ ${creds.database}`,
  )
  if (execute && changes.length > 0) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const c of changes) await conn.execute("UPDATE site_links SET archive_sort_order = ? WHERE id = ?", [c.rank, c.id])
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
    console.log(`已提交 ${changes.length} 行`)
  } else if (!execute && changes.length > 0) {
    console.log("dry-run：加 --execute 写库")
    process.exitCode = 2
  }
} finally {
  await pool.end()
}
}

main().catch((e) => {
  console.error(String((e as Error)?.message ?? e))
  process.exit(1)
})
