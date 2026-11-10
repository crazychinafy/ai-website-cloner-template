// P2 Schema 结构测试：对迁移后的 scratch 库做 information_schema 全量核对
// 覆盖：23 表存在、主键、唯一索引、普通索引、外键（含删除规则）、类型、默认值、引擎/字符集、BIGINT/ON UPDATE 形态
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool } from "./test-db"

let pool: Pool

type Row = Record<string, string | null>

beforeAll(async () => {
  pool = await freshMigratedPool()
}, 90_000)

afterAll(async () => {
  await dropScratch()
  await pool.end()
})

async function q(sql: string, ...params: (string | number | null)[]): Promise<Row[]> {
  const [rows] = await pool.query(sql, params)
  return rows as Row[]
}

const EXPECTED_TABLES = [
  "admin_users",
  "admin_roles",
  "admin_permissions",
  "admin_user_roles",
  "admin_role_permissions",
  "admin_sessions",
  "admin_login_attempts",
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
  "site_settings",
  "site_pages",
  "icon_libraries",
  "media_assets",
  "admin_audit_logs",
  "admin_import_runs",
]

describe("schema 结构", () => {
  it("23 张表全部存在且为 InnoDB + utf8mb4", async () => {
    // 注意：information_schema 是视图，结果列标签恒为大写（TABLE_NAME）——必须显式 AS 小写别名
    const rows = await q(
      "SELECT table_name AS table_name, engine AS engine, table_collation AS table_collation FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
      "facai8_p2_test",
    )
    const names = rows.map((r) => String(r.table_name)).sort()
    // 23 业务表 + __drizzle_migrations 跟踪表
    expect(names).toEqual([...EXPECTED_TABLES, "__drizzle_migrations"].sort())
    for (const r of rows.filter((r) => EXPECTED_TABLES.includes(String(r.table_name)))) {
      expect(String(r.engine)).toBe("InnoDB")
      expect(String(r.table_collation)).toBe("utf8mb4_0900_ai_ci")
    }
  })

  it("主键定义正确（含两个组合主键与 JSON 表 setting_key 主键）", async () => {
    const rows = await q(
      `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.key_column_usage
       WHERE table_schema = 'facai8_p2_test' AND constraint_name = 'PRIMARY'
       ORDER BY table_name, ordinal_position`,
    )
    const pks = new Map<string, string[]>()
    for (const r of rows) {
      const t = String(r.table_name)
      pks.set(t, [...(pks.get(t) ?? []), String(r.column_name)])
    }
    expect(pks.get("admin_users")).toEqual(["id"])
    expect(pks.get("admin_roles")).toEqual(["id"])
    expect(pks.get("admin_permissions")).toEqual(["id"])
    expect(pks.get("admin_user_roles")).toEqual(["user_id", "role_id"])
    expect(pks.get("admin_role_permissions")).toEqual(["role_id", "permission_id"])
    expect(pks.get("site_link_details")).toEqual(["link_id"])
    expect(pks.get("site_settings")).toEqual(["setting_key"])
    expect(pks.get("link_categories")).toEqual(["id"])
    expect(pks.get("media_assets")).toEqual(["id"])
    expect(pks.get("admin_import_runs")).toEqual(["id"])
  })

  it("唯一索引正确（用户名/email/角色/权限/session token/页面/媒体/图标）", async () => {
    const rows = await q(
      `SELECT table_name AS table_name, index_name AS index_name, column_name AS column_name FROM information_schema.statistics
       WHERE table_schema = 'facai8_p2_test' AND index_type = 'BTREE' AND non_unique = 0 AND index_name <> 'PRIMARY'
       ORDER BY table_name, index_name, seq_in_index`,
    )
    const uniques = new Map<string, string[]>()
    for (const r of rows) {
      const key = `${r.table_name}.${r.index_name}`
      uniques.set(String(key), [...(uniques.get(String(key)) ?? []), String(r.column_name)])
    }
    expect(uniques.get("admin_users.uq_admin_users_username")).toEqual(["username"])
    expect(uniques.get("admin_users.uq_admin_users_email")).toEqual(["email"])
    expect(uniques.get("admin_roles.uq_admin_roles_code")).toEqual(["code"])
    expect(uniques.get("admin_permissions.uq_admin_permissions_code")).toEqual(["code"])
    expect(uniques.get("admin_sessions.uq_admin_sessions_token_hash")).toEqual(["token_hash"])
    expect(uniques.get("site_pages.uq_site_pages_key")).toEqual(["page_key"])
    expect(uniques.get("media_assets.uq_media_storage_key")).toEqual(["storage_key"])
    expect(uniques.get("icon_libraries.uq_icon_libraries_hash")).toEqual(["hash"])
  })

  it("普通索引全部存在（抽查 12 个关键索引）", async () => {
    const idx = (name: string) =>
      q(`SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = 'facai8_p2_test' AND index_name = ?`, name)
    for (const name of [
      "idx_admin_users_status",
      "idx_admin_permissions_resource",
      "idx_admin_login_username_time",
      "idx_admin_login_ip_time",
      "idx_admin_sessions_user_expiry",
      "idx_article_categories_status_sort",
      "idx_link_categories_parent_sort",
      "idx_site_links_category_status_sort",
      "idx_site_links_tag_status",
      "idx_articles_category_status_date",
      "idx_ads_schedule",
      "idx_admin_audit_resource",
      "idx_admin_import_runs_status_time",
      "idx_media_sha256",
    ]) {
      const rows = await idx(name)
      expect(Number(rows[0]?.n ?? 0), `index ${name}`).toBeGreaterThan(0)
    }
  })

  it("外键与删除规则正确（RESTRICT/CASCADE/SET NULL 按设计）", async () => {
    const rows = await q(
      `SELECT k.table_name AS table_name, k.column_name AS column_name, k.referenced_table_name AS referenced_table_name,
              k.referenced_column_name AS referenced_column_name, UPPER(c.delete_rule) AS delete_rule
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints c
         ON c.constraint_name = k.constraint_name AND c.constraint_schema = k.table_schema
       WHERE k.table_schema = 'facai8_p2_test' AND k.referenced_table_name IS NOT NULL`,
    )
    const fks = rows.map((r) =>
      [r.table_name, r.column_name, r.referenced_table_name, r.referenced_column_name, r.delete_rule]
        .map(String)
        .join("->"),
    )
    expect(fks).toContain("admin_user_roles->user_id->admin_users->id->CASCADE")
    expect(fks).toContain("admin_user_roles->role_id->admin_roles->id->RESTRICT")
    expect(fks).toContain("admin_role_permissions->role_id->admin_roles->id->CASCADE")
    expect(fks).toContain("admin_role_permissions->permission_id->admin_permissions->id->CASCADE")
    expect(fks).toContain("admin_sessions->user_id->admin_users->id->CASCADE")
    expect(fks).toContain("link_categories->parent_id->link_categories->id->RESTRICT")
    expect(fks).toContain("site_links->category_id->link_categories->id->RESTRICT")
    expect(fks).toContain("site_links->tag_id->site_tags->id->RESTRICT")
    expect(fks).toContain("site_link_details->link_id->site_links->id->CASCADE")
    expect(fks).toContain("site_link_mirrors->link_id->site_links->id->CASCADE")
    expect(fks).toContain("articles->category_id->article_categories->id->RESTRICT")
    expect(fks).toContain("site_pages->updated_by->admin_users->id->SET NULL")
    expect(fks).toContain("site_settings->updated_by->admin_users->id->SET NULL")
    expect(fks).toContain("media_assets->uploaded_by->admin_users->id->SET NULL")
    expect(fks).toContain("admin_audit_logs->actor_user_id->admin_users->id->SET NULL")
    expect(fks).toContain("admin_import_runs->started_by->admin_users->id->SET NULL")
    expect(fks.length).toBe(16)
  })

  it("关键字段类型正确（BIGINT UNSIGNED / DATETIME(3) / JSON / LONGTEXT / VARBINARY / ENUM）", async () => {
    const rows = await q(
      `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable,
              column_default AS column_default, extra AS extra
       FROM information_schema.columns WHERE table_schema = 'facai8_p2_test'
       ORDER BY table_name, ordinal_position`,
    )
    const col = (t: string, c: string) =>
      rows.find((r) => String(r.table_name) === t && String(r.column_name) === c)

    // BIGINT UNSIGNED（17-20 位 ID 无损的前提）
    expect(String(col("admin_users", "id")?.column_type)).toBe("bigint unsigned")
    expect(String(col("site_links", "id")?.column_type)).toBe("bigint unsigned")
    expect(String(col("site_link_details", "click_count")?.column_type)).toBe("bigint unsigned")
    expect(String(col("media_assets", "size_bytes")?.column_type)).toBe("bigint unsigned")
    expect(String(col("admin_audit_logs", "actor_user_id")?.column_type)).toBe("bigint unsigned")

    // DATETIME(3) + 默认/ON UPDATE
    expect(String(col("admin_users", "created_at")?.column_type)).toBe("datetime(3)")
    expect(String(col("admin_users", "created_at")?.column_default)).toBe("CURRENT_TIMESTAMP(3)")
    expect(String(col("admin_users", "updated_at")?.extra).toLowerCase()).toContain("on update current_timestamp(3)")
    // DDL 缺陷修正验证：site_tags.created_at 不得带 ON UPDATE
    expect(String(col("site_tags", "created_at")?.extra ?? "").toLowerCase()).not.toContain("on update")

    // 其他类型
    expect(String(col("admin_users", "password_hash")?.column_type)).toBe("varchar(255)")
    expect(String(col("admin_users", "status")?.column_type)).toBe("enum('active','disabled','locked')")
    expect(String(col("admin_sessions", "token_hash")?.column_type)).toBe("char(64)")
    expect(String(col("admin_sessions", "ip_address")?.column_type)).toBe("varbinary(16)")
    expect(String(col("site_links", "description")?.column_type)).toBe("text")
    expect(String(col("articles", "content_html")?.column_type)).toBe("longtext")
    expect(String(col("site_settings", "setting_value")?.column_type)).toBe("json")
    expect(String(col("admin_import_runs", "mode")?.column_type)).toBe("enum('dry_run','import')")
    expect(String(col("admin_import_runs", "status")?.column_type)).toBe(
      "enum('pending','running','succeeded','failed','cancelled')",
    )
    expect(String(col("admin_import_runs", "error_summary")?.column_type)).toBe("text")

    // 默认值抽查（MySQL 8.0 的 information_schema 对 ENUM 默认值不带引号）
    expect(String(col("admin_users", "status")?.column_default)).toBe("active")
    expect(String(col("admin_users", "must_change_password")?.column_default)).toMatch(/^(1|true)/i)
    expect(String(col("site_links", "status")?.column_default)).toBe("published")
    expect(String(col("site_settings", "updated_at")?.extra).toLowerCase()).toContain("on update current_timestamp(3)")
  })

  it("所有 updated_at 列（13 个）均带毫秒级 ON UPDATE", async () => {
    const rows = await q(
      `SELECT table_name AS table_name FROM information_schema.columns
       WHERE table_schema = 'facai8_p2_test' AND column_name = 'updated_at'`,
    )
    const tables = rows.map((r) => String(r.table_name)).sort()
    expect(tables).toHaveLength(13)
    const bad = await q(
      `SELECT table_name AS table_name FROM information_schema.columns
       WHERE table_schema = 'facai8_p2_test' AND column_name = 'updated_at'
       AND LOWER(extra) NOT LIKE '%on update current_timestamp(3)%'`,
    )
    expect(bad).toHaveLength(0)
  })
})
