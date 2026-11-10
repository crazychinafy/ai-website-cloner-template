// P4 测试 2：导入（§12.2）—— dry-run 零写入 / 生产保护 / 库名确认 / 成功 / 重复保护 / 事务回滚 / 留痕
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { p4Creds, setupP4Scratch, teardownP4Scratch, importP4Snapshot } from "./p4-harness"
import { buildStaticSnapshot, computeChecksum, runStaticImport } from "../../scripts/admin/import-static-snapshot"

let pool: Pool

const TABLES = [
  "link_categories",
  "article_categories",
  "site_tags",
  "site_links",
  "site_link_details",
  "site_link_mirrors",
  "articles",
  "bulletins",
  "ads",
  "site_lines",
  "site_pages",
  "icon_libraries",
  "site_settings",
] as const

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of TABLES) {
    const res = (await pool.query(`SELECT COUNT(*) c FROM \`${t}\``)) as unknown as [unknown]
    out[t] = Number((res[0] as Array<{ c: number | string | bigint }>)[0]?.c ?? 0)
  }
  return out
}

async function runRows(): Promise<Array<{ id: string; status: string; checksum: string | null; startedBy: string | null }>> {
  const res = (await pool.query(`SELECT id, status, checksum, started_by FROM admin_import_runs ORDER BY id`)) as unknown as [unknown]
  return (res[0] as Array<{ id: number | string | bigint; status: string; checksum: string | null; started_by: number | string | bigint | null }>).map(
    (r) => ({ id: String(r.id), status: r.status, checksum: r.checksum, startedBy: r.started_by === null ? null : String(r.started_by) }),
  )
}

const VERSION = "p4-test"

beforeAll(async () => {
  pool = await setupP4Scratch()
}, 120_000)

afterAll(async () => {
  await teardownP4Scratch(pool)
}, 120_000)

describe("P4 导入（scratch facai8_p4_test）", () => {
  it("1. dry-run 不修改数据库（13 内容表 + admin_import_runs 全部零写入）", async () => {
    const res = await runStaticImport(p4Creds(), { snapshotVersion: VERSION, execute: false })
    expect(res.mode).toBe("dry_run")
    expect(res.ok).toBe(true)
    expect(res.outcome).toBe("planned")
    expect(res.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(res.counts.link_categories).toBe(94)
    expect(res.counts.site_links).toBe(3791)
    expect(res.counts.site_settings).toBe(10)
    const c = await counts()
    for (const t of TABLES) expect(c[t], `${t} 应仍为空`).toBe(0)
    expect((await runRows()).length).toBe(0) // dry-run 不留痕（P4 §8.2）
  })

  it("2. 生产环境默认禁止导入（NODE_ENV=production 未授权 → 拒绝且零写入）", async () => {
    const res = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION,
      execute: true,
      confirmDatabase: "facai8_p4_test",
      nodeEnv: "production",
      allowProduction: false,
      productionEnvAuthorized: false,
    })
    expect(res.outcome).toBe("refused")
    expect(res.ok).toBe(false)
    // 参数齐但环境变量未授权 → 仍拒绝（双因子）
    const res2 = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION,
      execute: true,
      confirmDatabase: "facai8_p4_test",
      nodeEnv: "production",
      allowProduction: true,
      productionEnvAuthorized: false,
    })
    expect(res2.outcome).toBe("refused")
    const c = await counts()
    for (const t of TABLES) expect(c[t]).toBe(0)
    expect((await runRows()).length).toBe(0)
  })

  it("3. --confirm-database 与实际库名不一致 → 拒绝且零写入", async () => {
    const res = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION,
      execute: true,
      confirmDatabase: "facai8_admin", // 与实际 scratch 不符
    })
    expect(res.outcome).toBe("refused")
    expect(res.error).toContain("confirm-database")
    const c = await counts()
    for (const t of TABLES) expect(c[t]).toBe(0)
    expect((await runRows()).length).toBe(0)
  })

  it("4. 事务回滚（注入非法外键 → 内容全部回滚 + 导入记录 failed；表中不留半套数据）", async () => {
    const snap = buildStaticSnapshot()
    // 破坏一条链接的外键：categoryId 指向不存在的分类
    snap.siteLinks[0] = { ...snap.siteLinks[0], categoryId: "1" }
    const res = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION,
      execute: true,
      confirmDatabase: "facai8_p4_test",
      snapshot: snap,
    })
    expect(res.outcome).toBe("rolled_back")
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/foreign key/i)
    const c = await counts()
    for (const t of TABLES) expect(c[t], `${t} 应整体回滚`).toBe(0)
    const rows = await runRows()
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe("failed")
    expect(rows[0].checksum).toBe(computeChecksum(snap))
    expect(rows[0].startedBy).toBeNull() // CLI 不伪造管理员
  })

  it("5. 正式导入成功（13 表全部落库 + 导入记录 succeeded + checksum 一致 + started_by NULL）", async () => {
    const res = await importP4Snapshot(VERSION)
    expect(res.outcome).toBe("imported")
    expect(res.ok).toBe(true)
    const expectCounts: Record<string, number> = {
      link_categories: 94,
      article_categories: 5,
      site_tags: 5,
      site_links: 3791,
      site_link_details: 122,
      site_link_mirrors: 98,
      articles: 28,
      bulletins: 1,
      ads: 14,
      site_lines: 5,
      site_pages: 4,
      icon_libraries: 5,
      site_settings: 10,
    }
    const c = await counts()
    for (const [t, n] of Object.entries(expectCounts)) expect(c[t], `${t}`).toBe(n)
    const rows = await runRows()
    // 第 4 条（failed）+ 本次（succeeded）
    const okRow = rows.find((r) => r.status === "succeeded")
    expect(okRow).toBeDefined()
    expect(okRow!.checksum).toBe(computeChecksum(buildStaticSnapshot()))
    expect(okRow!.startedBy).toBeNull()
  })

  it("6. 重复导入（同版本同 checksum 已成功）→ 安全 no-op，不重复写入", async () => {
    const before = await counts()
    const res = await importP4Snapshot(VERSION)
    expect(res.outcome).toBe("no_op")
    expect(res.ok).toBe(true)
    const after = await counts()
    expect(after).toEqual(before) // 一行未变
    expect((await runRows()).filter((r) => r.status === "succeeded").length).toBe(1) // 不新增记录
  })

  it("7. 同版本不同 checksum（快照内容变化）→ 拒绝执行", async () => {
    const snap = buildStaticSnapshot()
    snap.ads[0] = { ...snap.ads[0], title: "被篡改的广告" } // → checksum 变化
    const res = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION,
      execute: true,
      confirmDatabase: "facai8_p4_test",
      snapshot: snap,
    })
    expect(res.outcome).toBe("refused")
    expect(res.ok).toBe(false)
    // 内容表仍为上次成功导入的数据（未被覆盖）
    expect((await counts()).ads).toBe(14)
  })

  it("8. 目标非空且无匹配成功记录（不同版本号）→ 拒绝导入并报告冲突", async () => {
    const res = await runStaticImport(p4Creds(), {
      snapshotVersion: VERSION + "-other",
      execute: true,
      confirmDatabase: "facai8_p4_test",
    })
    expect(res.outcome).toBe("refused")
    expect(res.ok).toBe(false)
    expect(res.error).toContain("非空")
  })

  it("9. 导入过程记录正确（running→succeeded；failed 记录带 error_summary）", async () => {
    const res = (await pool.query(
      `SELECT status, checksum, snapshot_version, summary_json, error_summary FROM admin_import_runs ORDER BY id`,
    )) as unknown as [unknown]
    const rows = res[0] as Array<{
      status: string
      checksum: string
      snapshot_version: string
      summary_json: string | null
      error_summary: string | null
    }>
    expect(rows.length).toBe(2)
    expect(rows[0].status).toBe("failed")
    expect(rows[0].error_summary).toMatch(/foreign key/i)
    expect(rows[1].status).toBe("succeeded")
    expect(rows[1].error_summary).toBeNull()
    expect(rows[1].snapshot_version).toBe(VERSION)
    const summary = JSON.parse(rows[1].summary_json!) as { counts: Record<string, number>; total: number }
    expect(summary.counts.site_links).toBe(3791)
    expect(summary.total).toBe(
      Object.values(summary.counts).reduce((a, b) => a + b, 0),
    )
  })
})
