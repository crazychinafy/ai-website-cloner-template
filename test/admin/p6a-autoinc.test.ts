// P6A §14.1 / §9：AUTO_INCREMENT 切换验证（migration 0001）
// - 三张内容表 id 列：BIGINT UNSIGNED + EXTRA=auto_increment
// - 通过 Service 新建的记录 ID 由数据库顺序生成（不从外部传入）
// - site_links 等非内容主表保持原样（应用侧雪花 ID，不受 0001 影响）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { linkCategories, articleCategories, siteTags, siteLinks } from "../../src/lib/db/schema"
import {
  setupP6aEnv,
  teardownP6aEnv,
  p6aLogin,
  rawQuery,
  type P6aEnv,
  type P6aSession,
} from "./p6a-harness"
import { createCategory } from "../../src/lib/admin/services/category-service.ts"
import { createArticleCategory } from "../../src/lib/admin/services/article-category-service.ts"
import { createTag } from "../../src/lib/admin/services/tag-service.ts"

let env: P6aEnv
let session: P6aSession

const AUTOINC_TABLES = ["link_categories", "article_categories", "site_tags"] as const

interface ColumnProbe {
  COLUMN_TYPE: string
  EXTRA: string
}

beforeAll(async () => {
  env = await setupP6aEnv()
  session = await p6aLogin(env, "p6a_autoinc_admin", ["super_admin"])
}, 180_000)

afterAll(async () => {
  await teardownP6aEnv(env)
})

function wctx() {
  return {
    actorUserId: String(session.admin.id),
    requestId: "test-autoinc",
    req: new Request("http://admin.test/api/admin/v1/categories"),
  }
}

describe("P6A AUTO_INCREMENT（migration 0001）", () => {
  it("三张内容表 id = bigint unsigned + auto_increment", async () => {
    for (const table of AUTOINC_TABLES) {
      const rows = await rawQuery<ColumnProbe>(
        env.pool,
        "SELECT COLUMN_TYPE, EXTRA FROM information_schema.COLUMNS " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'id'",
        ["facai8_p6a_test", table],
      )
      expect(rows.length, table).toBe(1)
      expect(rows[0]!.COLUMN_TYPE, table).toBe("bigint unsigned")
      expect(rows[0]!.EXTRA, table).toContain("auto_increment")
    }
  })

  it("site_links 主键不受 0001 影响（仍由应用生成 ID）", async () => {
    const rows = await rawQuery<ColumnProbe>(
      env.pool,
      "SELECT COLUMN_TYPE, EXTRA FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_links' AND COLUMN_NAME = 'id'",
      ["facai8_p6a_test"],
    )
    expect(rows[0]!.COLUMN_TYPE).toBe("bigint unsigned")
    expect(rows[0]!.EXTRA).not.toContain("auto_increment")
  })

  it("Service 新建记录由数据库顺序生成 ID（string DTO，version 从 1 起）", async () => {
    const a = await createCategory(wctx(), { name: "p6a_autoinc_A" }, env.db)
    const b = await createCategory(wctx(), { name: "p6a_autoinc_B" }, env.db)
    const idA = BigInt(a.data.id)
    const idB = BigInt(b.data.id)
    expect(a.data.id).toMatch(/^[1-9][0-9]*$/)
    expect(a.data.version).toBe(1)
    expect(idB > idA).toBe(true)

    const ac = await createArticleCategory(wctx(), { name: "p6a_autoinc_文章" }, env.db)
    expect(BigInt(ac.data.id) > BigInt(0)).toBe(true)
    const tg = await createTag(wctx(), { name: "p6a_autoinc_标签" }, env.db)
    expect(BigInt(tg.data.id) > BigInt(0)).toBe(true)
  })

  it("插入后 MAX(id) 单调且无外部传入（DTO id === 库内 id）", async () => {
    const rows = await rawQuery<{ maxId: string }>(env.pool, "SELECT CAST(MAX(id) AS CHAR) AS maxId FROM link_categories")
    const created = await createCategory(wctx(), { name: "p6a_autoinc_C" }, env.db)
    expect(BigInt(created.data.id)).toBe(BigInt(rows[0]!.maxId) + BigInt(1))
    // DTO 是十进制字符串而不是 number
    expect(typeof created.data.id).toBe("string")
    // 外键完整性仍生效：引用不存在的分类直接报错
    await expect(
      env.db
        .insert(siteLinks)
        .values({
          id: BigInt("8700000000000000001"),
          categoryId: BigInt("9100000000000000999"),
          title: "p6a-fk",
          url: "https://example.com",
          description: "",
        })
        .execute(),
    ).rejects.toThrow()
  })

  it("AUTO_INCREMENT 单调不回退：新建 ID 大于库内既有最大值", async () => {
    const cats = await env.db.select({ id: linkCategories.id }).from(linkCategories)
    const before = Math.max(...cats.map((c) => Number(c.id)))
    const fresh = await createCategory(wctx(), { name: "p6a_autoinc_D" }, env.db)
    expect(Number(fresh.data.id)).toBeGreaterThan(before)
    const acs = await env.db.select({ id: articleCategories.id }).from(articleCategories)
    expect(acs.length).toBeGreaterThan(0)
    const tgs = await env.db.select({ id: siteTags.id }).from(siteTags)
    expect(tgs.length).toBeGreaterThan(0)
  })
})
