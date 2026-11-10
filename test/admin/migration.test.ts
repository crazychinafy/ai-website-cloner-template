// P2 Migration 行为测试：空库初始化 / 重复执行安全 / 数据不被破坏 / 外键阻止危险删除 / 不影响其他表
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { dropScratch, ensureScratch, makeDb, runMigrations } from "./test-db"
import * as schema from "../../src/lib/db/schema"

let pool: Pool

type Any = { query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> }

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [rows] = await (pool as Any).query(sql, params)
  const r = rows as Array<Record<string, unknown>>
  return Number(r[0]?.n ?? 0)
}

beforeAll(async () => {
  pool = await ensureScratch()
}, 90_000)

afterAll(async () => {
  await dropScratch()
  await pool.end()
})

describe("migration 行为", () => {
  it("空库初始化成功：23 张表 + __drizzle_migrations 跟踪表", async () => {
    await runMigrations(pool)
    expect(await count("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", "facai8_p2_test")).toBe(24)
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(1)
    const db = makeDb(pool)
    const links = await db.select({ id: schema.siteLinks.id }).from(schema.siteLinks)
    expect(links).toHaveLength(0)
  })

  it("重复执行 migration 是空操作（不重复建表、不破坏库）", async () => {
    // 先放数据
    await (pool as Any).query(
      "INSERT INTO site_tags (id, name, status) VALUES (94018707302518784, 'marker', 'active')",
    )
    await (pool as Any).query(
      "INSERT INTO link_categories (id, name, parent_id) VALUES (1, 'l1', NULL), (2, 'l2', 1)",
    )

    await runMigrations(pool) // 第二次执行
    expect(await count("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", "facai8_p2_test")).toBe(24)
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(1)
    // 数据仍在
    expect(await count("SELECT COUNT(*) AS n FROM site_tags")).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM link_categories")).toBe(2)
    expect(await count("SELECT COUNT(*) AS n FROM admin_users")).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM articles")).toBe(0)
  })

  it("第三次执行仍然幂等", async () => {
    await runMigrations(pool)
    expect(await count("SELECT COUNT(*) AS n FROM site_tags")).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(1)
  })

  it("外键阻止删除仍被引用的父记录（RESTRICT）", async () => {
    const catId = "9900000000000000001"
    await (pool as Any).query(
      "INSERT INTO link_categories (id, name) VALUES (?, 'fk-parent')",
      [catId],
    )
    await (pool as Any).query(
      "INSERT INTO site_links (id, category_id, title, url, description) VALUES (9900000000000000002, ?, 'x', 'https://x.example', '')",
      [catId],
    )
    await (pool as Any).query(
      "INSERT INTO site_links (id, category_id, title, url, description) VALUES (9900000000000000003, ?, 'y', 'https://y.example', '')",
      [catId],
    )
    let blocked = false
    try {
      await (pool as Any).query("DELETE FROM link_categories WHERE id = ?", [catId])
    } catch (err) {
      const e = err as { errno?: number; code?: string }
      // MySQL: 1451 = 被引用无法删除（RESTRICT）
      blocked = e.errno === 1451 || e.code === "ER_ROW_IS_REFERENCED_2"
    }
    expect(blocked).toBe(true)
    expect(await count("SELECT COUNT(*) AS n FROM link_categories WHERE id = ?", catId)).toBe(1)
  })

  it("CASCADE 按设计生效：删除网址时级联删除详情与备用链接", async () => {
    const catId = "9900000000000000011"
    const linkId = "9900000000000000012"
    await (pool as Any).query("INSERT INTO link_categories (id, name) VALUES (?, 'casc-cat')", [catId])
    await (pool as Any).query(
      "INSERT INTO site_links (id, category_id, title, url, description) VALUES (?, ?, 'casc', 'https://c.example', '')",
      [linkId, catId],
    )
    await (pool as Any).query(
      "INSERT INTO site_link_details (link_id, detail_html) VALUES (?, '<p>detail</p>')",
      [linkId],
    )
    await (pool as Any).query(
      "INSERT INTO site_link_mirrors (link_id, name, url) VALUES (?, 'm1', 'https://m1.example')",
      [linkId],
    )
    await (pool as Any).query("DELETE FROM site_links WHERE id = ?", [linkId])
    expect(await count("SELECT COUNT(*) AS n FROM site_link_details")).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM site_link_mirrors")).toBe(0)
  })

  it("删除管理员触发 SET NULL（updated_by 置空而非级联删）", async () => {
    await (pool as Any).query(
      "INSERT INTO admin_users (username, password_hash, display_name) VALUES ('setnull-admin', 'x', 'X')",
    )
    const [userRows] = await (pool as Any).query("SELECT id FROM admin_users WHERE username = 'setnull-admin'")
    const adminId = (userRows as Array<{ id: string }>)[0].id
    await (pool as Any).query(
      "INSERT INTO site_settings (setting_key, setting_value, updated_by) VALUES ('k1', '{}', ?)",
      [adminId],
    )
    await (pool as Any).query("DELETE FROM admin_users WHERE id = ?", [adminId])
    const [rows] = await (pool as Any).query("SELECT updated_by FROM site_settings WHERE setting_key = 'k1'")
    expect((rows as Array<{ updated_by: null }>)[0].updated_by).toBeNull()
  })

  it("迁移文件不含 DROP / TRUNCATE 语句", async () => {
    const { readFileSync, readdirSync } = await import("node:fs")
    const { join, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle")
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "")
      expect(sql, f).not.toMatch(/DROP\s+(TABLE|DATABASE)/i)
      expect(sql, f).not.toMatch(/TRUNCATE/i)
    }
  })
})
