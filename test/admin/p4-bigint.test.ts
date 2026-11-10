// P4 测试 4：BIGINT 精度（§12.4）—— 17/18 位 ID 全流程字符串一致（源 → 导入 → DB → Repository → DTO → JSON）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import * as schema from "../../src/lib/db/schema/index.ts"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { siteLinks } from "../../src/lib/db/schema/index.ts"
import { eq } from "drizzle-orm"
import { setupP4Scratch, teardownP4Scratch, importP4Snapshot } from "./p4-harness"
import { MySqlRepository } from "../../src/lib/facai8/content/mysql-repository"
import { ALL_LINKS } from "../../src/lib/facai8/data/links"
import { LINK_CATEGORIES } from "../../src/lib/facai8/data/categories"
import { LINK_DETAILS } from "../../src/lib/facai8/data/link-details"
import { LINK_MIRRORS } from "../../src/lib/facai8/data/link-mirrors"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import { TAGS } from "../../src/lib/facai8/data/tags"
import { ICON_LIBRARIES } from "../../src/lib/facai8/data/icon-libraries"
import { ALL_LINES } from "../../src/lib/facai8/data/lines"

let pool: Pool
let repo: MySqlRepository

const L18 = ALL_LINKS.filter((l) => l.id.length === 18)
const L17 = ALL_LINKS.filter((l) => l.id.length === 17)

beforeAll(async () => {
  pool = await setupP4Scratch()
  const res = await importP4Snapshot("p4-test")
  if (res.outcome !== "imported" && res.outcome !== "no_op") throw new Error(`setup import failed: ${res.outcome} ${res.error}`)
  repo = new MySqlRepository(drizzle(pool, { schema, mode: "default" }) as unknown as MySql2Database<typeof schema>)
}, 180_000)

afterAll(async () => {
  await teardownP4Scratch(pool)
}, 120_000)

describe("P4 BIGINT 精度（17/18 位 ID 全流程）", () => {
  it("源数据存在 17 位与 18 位 ID（测试前提）", () => {
    expect(L17.length).toBeGreaterThan(0)
    expect(L18.length).toBeGreaterThan(0)
  })

  it("18 位 ID：DTO 与源字符串完全一致（源数据大部分经 Number 化会丢精度 —— 证明必须走字符串）", async () => {
    for (const l of L18.slice(0, 30)) {
      const dto = await repo.getLinkById(l.id)
      expect(dto, l.id).not.toBeNull()
      expect(dto!.id).toBe(l.id)
      expect(dto!.categoryId).toBe(l.categoryId)
    }
    // 佐证：档案 266 个 18 位 ID 中 217 个 Number(...).toString() 后失真（少数恰能往返 → 断言“过半失真”而非“全部”）
    const loser = L18.filter((l) => Number(l.id).toString() !== l.id).length
    expect(loser).toBeGreaterThan(L18.length / 2)
  })

  it("17 位 ID 抽样全等（含详情 / 镜像关联链路）", async () => {
    for (const l of L17.slice(0, 20)) {
      const dto = await repo.getLinkById(l.id)
      expect(dto!.id).toBe(l.id)
    }
    // 详情链路：detail.id == link.id（17 位）
    const detIds = Object.keys(LINK_DETAILS).slice(0, 10)
    for (const id of detIds) {
      const dto = await repo.getLinkDetail(id)
      expect(dto!.id).toBe(id)
    }
    // 镜像链路：mirror.id 17 位
    for (const [linkId, arr] of Object.entries(LINK_MIRRORS).slice(0, 10)) {
      const rows = await repo.getLinkMirrors(linkId)
      expect(rows.map((m) => m.id)).toEqual(arr.map((m) => m.id))
    }
  })

  it("计数列（click/like/view）以字符串返回且值全等", async () => {
    const d = await repo.getLinkDetail(Object.keys(LINK_DETAILS)[0])
    expect(d!.clickCount).toBe(LINK_DETAILS[Object.keys(LINK_DETAILS)[0]].clickCount)
    expect(d!.likeCount).toBe(LINK_DETAILS[Object.keys(LINK_DETAILS)[0]].likeCount)
    const a = await repo.getArticleById(ALL_ARTICLES[0].id)
    expect(a!.viewCount).toBe(ALL_ARTICLES[0].viewCount)
    expect(typeof a!.viewCount).toBe("string")
  })

  it("分类 / 文章 / 标签 / 图标库 / 线路 ID 全等（各取前 10）", async () => {
    const cats = (await repo.getHomeCategories()).slice(0, 10)
    const srcCats = LINK_CATEGORIES.slice(0, 10)
    expect(cats.map((c) => c.id)).toEqual(srcCats.map((c) => c.id))

    const arts = (await repo.getArticles()).slice(0, 10)
    expect(arts.length).toBe(10)
    for (const a of arts) expect(/^\d{17,18}$/.test(a.id)).toBe(true)

    const tags = await repo.getTags()
    expect(tags.map((t) => t.id)).toEqual(TAGS.map((t) => t.id))

    const icons = (await repo.getIconLibraries()).slice(0, 5)
    expect(icons.map((i) => i.id)).toEqual(
      ICON_LIBRARIES.slice()
        .sort((a, b) => (a.id.length !== b.id.length ? a.id.length - b.id.length : a.id < b.id ? -1 : 1))
        .slice(0, 5)
        .map((i) => i.id),
    )

    const lines = await repo.getLines()
    expect(lines.map((l) => l.id)).toEqual(ALL_LINES.map((l) => l.id))
  })

  it("数据库侧原始读回（mysql2 bigNumberStrings → 字符串）与源一致", async () => {
    const l18 = L18[0]
    const db = drizzle(pool, { schema, mode: "default" }) as unknown as MySql2Database<typeof schema>
    const rows = await db.select().from(siteLinks).where(eq(siteLinks.id, BigInt(l18.id)))
    expect(rows.length).toBe(1)
    // drizzle mode:"bigint" 读回为 JS BigInt → 十进制字符串与源一致（20 位无损）
    expect(String(rows[0].id)).toBe(l18.id)
    // 原始 SQL 查询（bigNumberStrings）→ 字符串
    const res = (await pool.query(`SELECT id FROM site_links WHERE id = ?`, [l18.id])) as unknown as [unknown]
    expect(String((res[0] as Array<{ id: string }>)[0].id)).toBe(l18.id)
  })

  it("DTO JSON 序列化稳定（18 位 ID 不变形）", async () => {
    const l18 = L18[0]
    const dto = await repo.getLinkById(l18.id)
    const json = JSON.stringify(dto)
    expect(json).toContain(`"id":"${l18.id}"`)
  })
})
