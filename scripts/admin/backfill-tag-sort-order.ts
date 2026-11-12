// P8-0：site_links.tag_sort_order 回填（migration 0006 新增列的一次性数据修复）。
// 规则（与导入器/后台维护同一合同，见 content/repository.ts §P8-0）：
//   - 快照内链接（source_snapshot 冻结源）：rank = computeTagSortRanks()（TAG_ORDER 序列 + 档案序追加），
//     与前台标签页（static-repository.getLinksByTag）逐位一致；
//   - 快照外链接（后台新建/改标签，不在冻结源中）：按 id 升序追加到该标签组快照 rank 之后（组内 max+1 起）；
//   - tag_id 为 NULL 的行不写（保持 NULL）。
// 不触 version/updated_at（排序元数据修复，不参与乐观锁）。默认 dry-run，必须显式 --execute 才写库。
// 用法：
//   DB_USER=... DB_PASSWORD=... DB_NAME=facai8_admin node scripts/admin/backfill-tag-sort-order.ts [--execute]
import mysql from "mysql2/promise"
import { computeTagSortRanks } from "../../src/lib/admin/import/static-import-core.ts"

const execute = process.argv.includes("--execute")
const creds = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "facai8_admin",
  user: process.env.DB_USER ?? "facai8_app",
  password: process.env.DB_PASSWORD ?? "",
}

const ranks = computeTagSortRanks() // 冻结源快照 rank（link id → 组内稠密排名）

// supportBigNumber*：BIGINT 以精确字符串返回（雪花 ID 超出 JS 安全整数，默认会精度损毁）
// async main 包装（不用顶层 await：tsx 在 cjs 转译下不支持）
async function main() {
const pool = await mysql.createPool({ ...creds, charset: "UTF8MB4_UNICODE_CI", connectionLimit: 2, supportBigNumbers: true, bigNumberStrings: true })
try {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, tag_id, tag_sort_order FROM site_links WHERE tag_id IS NOT NULL ORDER BY tag_id, id",
  )
  // 每个标签组：快照 rank 行数 = 该组已分配 rank 的上界（快照 rank 稠密 0..n-1）；快照外行按 id 升序尾追
  const groupUsed = new Map<string, number>() // tagId → 已占用 rank 数（下一个可分配值）
  for (const row of rows) {
    const id = String(row.id)
    if (ranks.has(id)) {
      const tag = String(row.tag_id)
      groupUsed.set(tag, (groupUsed.get(tag) ?? 0) + 1)
    }
  }
  const plan: { id: string; rank: number; changed: boolean }[] = []
  for (const row of rows) {
    const id = String(row.id)
    const tag = String(row.tag_id)
    let rank: number
    const snap = ranks.get(id)
    if (snap !== undefined) {
      rank = snap
    } else {
      rank = groupUsed.get(tag) ?? 0
      groupUsed.set(tag, rank + 1)
    }
    const current = row.tag_sort_order === null ? null : Number(row.tag_sort_order)
    plan.push({ id, rank, changed: current !== rank })
  }
  const changes = plan.filter((p) => p.changed)
  const snapshot = rows.filter((r) => ranks.has(String(r.id))).length
  console.log(
    `标签行 ${rows.length}（快照内 ${snapshot} / 快照外 ${rows.length - snapshot}），需写入 ${changes.length} 行 @ ${creds.database}`,
  )
  if (execute && changes.length > 0) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const c of changes) await conn.execute("UPDATE site_links SET tag_sort_order = ? WHERE id = ?", [c.rank, c.id])
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
