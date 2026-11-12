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
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(6) // P6D：0000-0005
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
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(6)
    // 数据仍在
    expect(await count("SELECT COUNT(*) AS n FROM site_tags")).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM link_categories")).toBe(2)
    expect(await count("SELECT COUNT(*) AS n FROM admin_users")).toBe(0)
    expect(await count("SELECT COUNT(*) AS n FROM articles")).toBe(0)
  })

  it("第三次执行仍然幂等", async () => {
    await runMigrations(pool)
    expect(await count("SELECT COUNT(*) AS n FROM site_tags")).toBe(1)
    expect(await count("SELECT COUNT(*) AS n FROM __drizzle_migrations")).toBe(6)
  })

  // P6B：0003 把 site_links.id 切成 AUTO_INCREMENT（保留快照显式 ID 的能力）
  it("0003：site_links.id 为 AUTO_INCREMENT，且仍允许显式写入 17/18 位快照 ID", async () => {
    const [col] = await (pool as Any).query(
      "SELECT LOWER(extra) AS e FROM information_schema.columns WHERE table_schema = 'facai8_p2_test' AND table_name = 'site_links' AND column_name = 'id'",
    )
    expect(String((col as Array<{ e: string }>)[0].e)).toContain("auto_increment")

    await (pool as Any).query("INSERT INTO link_categories (id, name) VALUES (9900000000000000020, 'ai-cat')")
    // 显式大 ID（模拟静态快照导入）
    await (pool as Any).query(
      "INSERT INTO site_links (id, category_id, title, url, description) VALUES (112546110991634432, 9900000000000000020, 'snapshot', 'https://s.example', '')",
    )
    // 省略 ID（P6B 后台新建路径）→ 数据库生成
    await (pool as Any).query("INSERT INTO site_links (category_id, title, url, description) VALUES (9900000000000000020, 'generated', 'https://g.example', '')")
    const [rows] = await (pool as Any).query(
      "SELECT id FROM site_links WHERE title = 'generated'",
    )
    const genId = BigInt((rows as Array<{ id: string }>)[0].id)
    expect(genId > BigInt("112546110991634432")).toBe(true) // 起点 = max+1，永不与快照 ID 冲突
    expect(await count("SELECT COUNT(*) AS n FROM site_links")).toBe(2) // 本用例新建 snapshot + generated
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

// P6A.1：0002 前置检查行为——已有「未删除同名」冲突数据时必须明确报错（绝不自动删/改名），
// 处理后可重跑成功。用独立 scratch 库手工分文件应用 SQL，模拟 0002 尚未执行的历史库。
describe("migration 0002 前置检查（P6A.1 名称唯一）", () => {
  const DB2 = "facai8_p2_mig2"
  let pool2: Pool

  async function count2(sql: string, ...params: unknown[]): Promise<number> {
    const [rows] = await (pool2 as Any).query(sql, params)
    const r = rows as Array<Record<string, unknown>>
    return Number(r[0]?.n ?? 0)
  }

  async function applyFile(name: string): Promise<void> {
    const { readFileSync } = await import("node:fs")
    const { join, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle")
    const raw = readFileSync(join(dir, name), "utf8")
    // 与 drizzle migrator 相同的切分方式；多行 CREATE PROCEDURE 体保持单条语句
    for (const part of raw.split("--> statement-breakpoint")) {
      const s = part.trim()
      if (s) await (pool2 as Any).query(s)
    }
  }

  beforeAll(async () => {
    pool2 = await ensureScratch(DB2)
  }, 90_000)

  afterAll(async () => {
    await dropScratch(DB2)
    await pool2.end()
  })

  it("存在未删除同名数据时：0002 明确报错，表结构与数据保持不变", async () => {
    await applyFile("0000_fair_magdalene.sql")
    await applyFile("0001_spotty_lord_tyger.sql")
    await (pool2 as Any).query("INSERT INTO link_categories (id, name) VALUES (101, '同名冲突'), (102, '同名冲突')")

    let msg = ""
    try {
      await applyFile("0002_last_imperial_guard.sql")
    } catch (e) {
      msg = String((e as { message?: string }).message ?? e)
    }
    expect(msg).not.toBe("") // 必须失败
    expect(msg).toContain("link_categories")
    expect(msg).toContain("同名冲突")
    // 绝不自动处理数据：行仍在、列未加
    expect(await count2("SELECT COUNT(*) AS n FROM link_categories WHERE name = '同名冲突'")).toBe(2)
    expect(
      await count2(
        "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'link_categories' AND column_name = 'active_name'",
        DB2,
      ),
    ).toBe(0)
  })

  it("冲突消除后重跑成功：生成列 + UNIQUE 生效；软删除历史同名行可共存", async () => {
    await (pool2 as Any).query("UPDATE link_categories SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id IN (101, 102)")
    await applyFile("0002_last_imperial_guard.sql") // 上次失败残留的 Procedure 由文件首行 DROP IF EXISTS 清理

    expect(
      await count2(
        "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'link_categories' AND column_name IN ('active_name', 'parent_scope_id')",
        DB2,
      ),
    ).toBe(2)
    expect(
      await count2(
        "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'link_categories' AND index_name = 'uq_link_categories_active_name'",
        DB2,
      ),
    ).toBe(2) // 两列复合唯一索引

    // 软删除行退出约束 → 同名可再建；未删除同名再建被数据库层拒绝
    await (pool2 as Any).query("INSERT INTO link_categories (id, name) VALUES (103, '同名冲突')")
    let dupBlocked = false
    try {
      await (pool2 as Any).query("INSERT INTO link_categories (id, name) VALUES (104, '同名冲突')")
    } catch (e) {
      const err = e as { code?: string; errno?: number }
      dupBlocked = err.code === "ER_DUP_ENTRY" || err.errno === 1062
    }
    expect(dupBlocked).toBe(true)
    // 不同父级同名仍允许（哨兵 0 作用域）
    await (pool2 as Any).query("INSERT INTO link_categories (id, name, parent_id) VALUES (105, '同名冲突', 103)")
    expect(await count2("SELECT COUNT(*) AS n FROM link_categories WHERE name = '同名冲突' AND deleted_at IS NULL")).toBe(2)
  })
})
