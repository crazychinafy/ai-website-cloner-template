// P2 BIGINT 精度测试：17/18/20 位 ID 在 写入→查询→DTO→JSON 全链路保持字符串完全一致
// 覆盖三层：drizzle 查询层（BigInt）/ mysql2 驱动层（bigNumberStrings）/ 应用 client.ts 池配置
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, makeDb } from "./test-db"
import * as schema from "../../src/lib/db/schema"
import { eq } from "drizzle-orm"

let pool: Pool

const ID_17 = "94018707302518784" // 17 位（源站分类 ID 形态）
const ID_17B = "19035113210940321" // 17 位（驱动层用例专用，避免与前面用例的主键冲突）
const ID_18 = "112546110991634432" // 18 位（源站链接 ID 形态）
const ID_MAX = "18446744073709551615" // BIGINT UNSIGNED 上限（20 位）

beforeAll(async () => {
  pool = await freshMigratedPool()
}, 90_000)

afterAll(async () => {
  await dropScratch()
  await pool.end()
})

describe("BIGINT 精度（drizzle 层）", () => {
  it("17 位 ID 写入→查询→字符串 DTO→JSON 全程无损", async () => {
    const db = makeDb(pool)
    await db.insert(schema.siteTags).values({ id: BigInt(ID_17), name: "t17" })
    const [row] = await db.select().from(schema.siteTags).where(eq(schema.siteTags.id, BigInt(ID_17)))
    expect(row.id).toBe(BigInt(ID_17)) // BigInt 精确相等（非 Number 比较）
    const dto = { id: String(row.id) } // DTO 一律字符串
    const json = JSON.stringify(dto)
    expect(json).toBe('{"id":"94018707302518784"}')
    expect(JSON.parse(json).id).toBe(ID_17) // 反序列化后仍为原字符串
  })

  it("18 位 ID（链接+详情+备用链接链式 FK）全程无损", async () => {
    const db = makeDb(pool)
    const catId = BigInt("11111111111111111")
    await db.insert(schema.linkCategories).values({ id: catId, name: "c" })
    await db
      .insert(schema.siteLinks)
      .values({ id: BigInt(ID_18), categoryId: catId, title: "L18", url: "https://e.example", description: "" })
    await db
      .insert(schema.siteLinkDetails)
      .values({ linkId: BigInt(ID_18), detailHtml: "<p>x</p>", clickCount: BigInt("1234567890123456789") })
    await db.insert(schema.siteLinkMirrors).values({ linkId: BigInt(ID_18), name: "m", url: "https://m.example" })

    const [link] = await db.select().from(schema.siteLinks).where(eq(schema.siteLinks.id, BigInt(ID_18)))
    expect(String(link.id)).toBe(ID_18)
    const [detail] = await db.select().from(schema.siteLinkDetails).where(eq(schema.siteLinkDetails.linkId, BigInt(ID_18)))
    expect(String(detail.linkId)).toBe(ID_18)
    expect(detail.clickCount).toBe(BigInt("1234567890123456789")) // 19 位计数同样无损
    const [mirror] = await db.select().from(schema.siteLinkMirrors).where(eq(schema.siteLinkMirrors.linkId, BigInt(ID_18)))
    expect(String(mirror.linkId)).toBe(ID_18)

    // DTO 组装（模拟 P3+ 的响应序列化）
    const dto = {
      link: { id: String(link.id), category: String(link.categoryId) },
      detail: { link: String(detail.linkId), clicks: String(detail.clickCount) },
      mirror: { link: String(mirror.linkId) },
    }
    const round = JSON.parse(JSON.stringify(dto))
    expect(round.link.id).toBe(ID_18)
    expect(round.detail.link).toBe(ID_18)
    expect(round.detail.clicks).toBe("1234567890123456789")
    expect(round.mirror.link).toBe(ID_18)
  })

  it("BIGINT UNSIGNED 上限（20 位）读写无损", async () => {
    const db = makeDb(pool)
    await db.insert(schema.siteTags).values({ id: BigInt(ID_MAX), name: "tmax" })
    const [row] = await db.select().from(schema.siteTags).where(eq(schema.siteTags.id, BigInt(ID_MAX)))
    expect(row.id).toBe(BigInt(ID_MAX))
    expect(String(row.id)).toBe(ID_MAX)
  })
})

describe("BIGINT 精度（mysql2 驱动层）", () => {
  it("raw 查询以字符串返回 17 位 ID（bigNumberStrings 生效）", async () => {
    const db = makeDb(pool)
    await db.insert(schema.siteTags).values({ id: BigInt(ID_17B), name: "raw" })
    const [rows] = await pool.query("SELECT id FROM site_tags WHERE id = ? AND name = ?", [ID_17B, "raw"])
    const r = rows as Array<{ id: string }>
    expect(r[0].id).toBe(ID_17B) // 字符串逐字符相等，而非数值
    expect(typeof r[0].id).toBe("string")
  })

  it("字符串参数回写后再读仍一致（参数绑定不转 Number）", async () => {
    const [rows] = await pool.query("SELECT ? AS v", [ID_MAX])
    const r = rows as Array<{ v: string }>
    expect(r[0].v).toBe(ID_MAX)
  })
})

describe("BIGINT 精度（应用 client.ts 池配置）", () => {
  it("getDrizzle() 链路（server-only 打桩）对 17 位 ID 无损", async () => {
    const c = (await import("./test-db")).readCreds()
    process.env.DB_HOST = c.host
    process.env.DB_PORT = String(c.port)
    process.env.DB_NAME = "facai8_p2_test"
    process.env.DB_USER = c.user
    process.env.DB_PASSWORD = c.password

    const client = await import("../../src/lib/db/client.ts")
    try {
      const db = client.getDrizzle()
      const [row] = await db.select().from(schema.siteTags).where(eq(schema.siteTags.id, BigInt(ID_17)))
      expect(String(row.id)).toBe(ID_17)
    } finally {
      await client.closeDb()
      delete process.env.DB_PASSWORD
    }
  })
})
