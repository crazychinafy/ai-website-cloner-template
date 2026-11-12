// P7 测试：Dashboard Service（真实 DB 统计，无虚构数字）
// ─────────────────────────────────────────────────────────────────
// - 指标 = 种子行真实 COUNT，软删除/状态口径逐项核对（每条指标带「口径」说明）
// - 权限过滤：无 xxx.read 的指标不查询也不返回
// - 权限字典数量 = admin_permissions 实时 COUNT（修复旧版硬编码「权限 46 项」）
// - 最近导入 = ORDER BY id DESC LIMIT 1，含 CLI startedBy=NULL 行
// - DB 异常 → dbOk=false 且数字为 null（绝不吞错返回 0）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "../../src/lib/db/schema"
import { getDashboardData } from "../../src/lib/admin/services/dashboard-service.ts"
import { makeAppDb } from "./test-admin.ts"
import { readCreds } from "./test-db.ts"
import {
  countRows,
  p7Login,
  setupP7Env,
  teardownP7Env,
  type P7Env,
} from "./p7-harness.ts"

const ALL_READS = [
  "dashboard.read",
  "links.read",
  "articles.read",
  "bulletins.read",
  "ads.read",
  "categories.read",
  "article_categories.read",
  "tags.read",
  "lines.read",
  "settings.read",
  "administrators.read",
  "imports.preview",
]

let env: P7Env
let adminId: string
let catId: string
let artCatId: string

async function metricValue(perms: string[], key: string): Promise<{ value: number; caliber: string } | undefined> {
  const data = await getDashboardData(perms, env.db)
  expect(data.dbOk).toBe(true)
  return [...data.content, ...data.system].find((m) => m.key === key)
}

beforeAll(async () => {
  env = await setupP7Env()
  const db = env.db

  // 登录管理员（RBAC 已 seed：4 角色 / 46 权限）
  const session = await p7Login(env, "p7-dash-admin", ["super_admin"])
  adminId = session.admin.id.toString()

  // 第二个（停用）管理员
  await db.insert(schema.adminUsers).values({
    username: "p7-dash-disabled",
    passwordHash: "p7-not-a-real-hash",
    displayName: "停用管理员",
    status: "disabled",
    mustChangePassword: false,
  })

  // 分类（父子两条）+ 文章分类
  const [lc] = await db.insert(schema.linkCategories).values({ name: "Dash分类" }).$returningId()
  catId = String(lc.id)
  await db.insert(schema.linkCategories).values({ name: "Dash分类2", parentId: BigInt(catId) })
  const [ac] = await db.insert(schema.articleCategories).values({ name: "Dash文章分类" }).$returningId()
  artCatId = String(ac.id)

  // 标签 2
  await db.insert(schema.siteTags).values([{ name: "tag-a" }, { name: "tag-b" }])

  // 网址：2 published + 1 draft + 1 软删除（软删行任何口径都不计）
  await db.insert(schema.siteLinks).values([
    { categoryId: BigInt(catId), title: "L1", url: "https://a.test", description: "", status: "published" },
    { categoryId: BigInt(catId), title: "L2", url: "https://b.test", description: "", status: "published" },
    { categoryId: BigInt(catId), title: "L3", url: "https://c.test", description: "", status: "draft" },
    {
      categoryId: BigInt(catId),
      title: "L4",
      url: "https://d.test",
      description: "",
      status: "published",
      deletedAt: "2026-01-01 00:00:00.000",
    },
  ])

  // 文章：1 published + 1 draft + 1 软删除
  await db.insert(schema.articles).values([
    { categoryId: BigInt(artCatId), title: "A1", contentHtml: "<p>a</p>", status: "published" },
    { categoryId: BigInt(artCatId), title: "A2", contentHtml: "<p>b</p>", status: "draft" },
    {
      categoryId: BigInt(artCatId),
      title: "A3",
      contentHtml: "<p>c</p>",
      status: "published",
      deletedAt: "2026-01-01 00:00:00.000",
    },
  ])

  // 公告 2、广告 1、设置 2
  await db.insert(schema.bulletins).values([
    { title: "B1", contentHtml: "<p>b1</p>" },
    { title: "B2", contentHtml: "<p>b2</p>", status: "draft" },
  ])
  await db.insert(schema.ads).values({ title: "Ad1", targetUrl: "https://ad.test", imagePath: "/ads/1.png" })
  await db.insert(schema.siteSettings).values([
    { settingKey: "p7_dash_k1", settingValue: { v: 1 } },
    { settingKey: "p7_dash_k2", settingValue: { v: 2 } },
  ])

  // 导入历史：A=succeeded（Web 管理员触发）、B=dry_run/failed（CLI 触发，startedBy NULL，id 更大）
  await db.insert(schema.adminImportRuns).values([
    {
      snapshotVersion: "v-old",
      mode: "import",
      status: "succeeded",
      startedBy: BigInt(adminId),
      startedAt: "2026-11-01 08:00:00.000",
    },
    {
      snapshotVersion: "v-new",
      mode: "dry_run",
      status: "failed",
      startedBy: null,
      startedAt: "2026-11-02 09:00:00.000",
    },
  ])
}, 120_000)

afterAll(async () => {
  await teardownP7Env(env)
})

describe("Dashboard：真实计数与口径", () => {
  it("内容指标 = 种子行 COUNT（软删除不计、已发布口径分列）", async () => {
    const data = await getDashboardData(ALL_READS, env.db)
    expect(data.dbOk).toBe(true)
    const byKey = new Map(data.content.map((m) => [m.key, m]))

    expect(byKey.get("links")!.value).toBe(3) // 4 行中 1 行软删除
    expect(byKey.get("links_published")!.value).toBe(2)
    expect(byKey.get("articles")!.value).toBe(2)
    expect(byKey.get("articles_published")!.value).toBe(1)
    expect(byKey.get("bulletins")!.value).toBe(2)
    expect(byKey.get("ads")!.value).toBe(1)
    expect(byKey.get("link_categories")!.value).toBe(2)
    expect(byKey.get("article_categories")!.value).toBe(1)
    expect(byKey.get("tags")!.value).toBe(2)
    expect(byKey.get("lines")!.value).toBe(0)
    expect(byKey.get("settings")!.value).toBe(2)
  })

  it("每条指标都带非空「口径」说明（用户能看到数字含义）", async () => {
    const data = await getDashboardData(ALL_READS, env.db)
    for (const m of [...data.content, ...data.system]) {
      expect(m.caliber.length, `${m.key} 口径缺失`).toBeGreaterThan(0)
    }
    const byKey = new Map(data.content.map((m) => [m.key, m]))
    expect(byKey.get("links")!.caliber).toContain("deleted_at IS NULL")
    expect(byKey.get("links_published")!.caliber).toContain("published")
  })

  it("系统指标：管理员含停用、角色含系统、权限字典 = admin_permissions 实时 COUNT", async () => {
    const livePerms = await countRows(env.pool, "admin_permissions")
    expect(livePerms).toBeGreaterThan(0)
    const byKey = new Map((await getDashboardData(ALL_READS, env.db)).system.map((m) => [m.key, m]))
    expect(byKey.get("admins")!.value).toBe(2) // active + disabled 都算
    expect(byKey.get("roles")!.value).toBe(await countRows(env.pool, "admin_roles"))
    expect(byKey.get("permissions")!.value).toBe(livePerms)

    // 新增一条权限 → 指标 +1（修复回归点：不是硬编码 46，DB 变化即时反映）
    await env.db
      .insert(schema.adminPermissions)
      .values({ code: "p7.metric.probe", name: "探针权限", resource: "p7.metric", action: "read" })
    const after = await metricValue(ALL_READS, "permissions")
    expect(after!.value).toBe(livePerms + 1)
    await env.db.delete(schema.adminPermissions).where(eq(schema.adminPermissions.code, "p7.metric.probe"))
    const back = await metricValue(ALL_READS, "permissions")
    expect(back!.value).toBe(livePerms)
  })
})

describe("Dashboard：权限过滤（口径 = 权限边界）", () => {
  it("只有 links.read → 内容组仅 links 两项，系统组空，导入区不可见", async () => {
    const data = await getDashboardData(["dashboard.read", "links.read"], env.db)
    expect(data.dbOk).toBe(true)
    expect(data.content.map((m) => m.key)).toEqual(["links", "links_published"])
    expect(data.system).toEqual([])
    expect(data.latestRun).toBeNull()
    expect(data.runsTotal).toBeNull()
    expect(data.runsSucceeded).toBeNull()
  })

  it("无任何 read 权限 → 空指标（而不是伪造满屏 0）", async () => {
    const data = await getDashboardData([], env.db)
    expect(data.dbOk).toBe(true)
    expect(data.content).toEqual([])
    expect(data.system).toEqual([])
    expect(data.runsTotal).toBeNull()
  })
})

describe("Dashboard：最近导入（ORDER BY id DESC LIMIT 1）", () => {
  it("取 id 最大的一行；CLI 行 startedBy=null 原样呈现", async () => {
    const data = await getDashboardData(ALL_READS, env.db)
    expect(data.runsTotal).toBe(2)
    expect(data.runsSucceeded).toBe(1)
    expect(data.latestRun).not.toBeNull()
    // id 最大的是 dry_run/failed（CLI，startedBy NULL），而不是更早的 succeeded
    expect(data.latestRun!.status).toBe("failed")
    expect(data.latestRun!.snapshotVersion).toBe("v-new")
    expect(data.latestRun!.startedBy).toBeNull()

    // 追加更新的 Web 导入行 → latest 翻转且 startedBy = 真实管理员 id
    const [r] = await env.db
      .insert(schema.adminImportRuns)
      .values({ snapshotVersion: "v-latest", mode: "import", status: "succeeded", startedBy: BigInt(adminId) })
      .$returningId()
    const after = await getDashboardData(ALL_READS, env.db)
    expect(after.latestRun!.id).toBe(String(r.id))
    expect(after.latestRun!.startedBy).toBe(adminId)
    expect(after.runsTotal).toBe(3)
    expect(after.runsSucceeded).toBe(2)

    await env.db.delete(schema.adminImportRuns).where(eq(schema.adminImportRuns.id, BigInt(String(r.id))))
  })

  it("无导入历史 → latestRun=null（不是伪造记录）", async () => {
    const rows = await env.db.select({ id: schema.adminImportRuns.id }).from(schema.adminImportRuns)
    for (const r of rows) {
      await env.db.delete(schema.adminImportRuns).where(eq(schema.adminImportRuns.id, r.id))
    }
    const data = await getDashboardData(ALL_READS, env.db)
    expect(data.latestRun).toBeNull()
    expect(data.runsTotal).toBe(0)
    expect(data.runsSucceeded).toBe(0)
  })
})

describe("Dashboard：DB 异常（不吞错为 0）", () => {
  it("连接失败 → dbOk=false，数字为 null，指标为空数组", async () => {
    // 独立池连到不存在的库（不影响共享池）；查询必失败
    const { createPool } = await import("mysql2/promise")
    const creds = readCreds()
    const deadPool = createPool({
      host: creds.host,
      port: creds.port,
      user: creds.user,
      password: creds.password,
      database: "facai8_p7_no_such_db",
      connectionLimit: 2,
    })
    try {
      const data = await getDashboardData(ALL_READS, makeAppDb(deadPool))
      expect(data.dbOk).toBe(false)
      expect(data.content).toEqual([])
      expect(data.system).toEqual([])
      expect(data.latestRun).toBeNull()
      expect(data.runsTotal).toBeNull() // null ≠ 0：UI 显示「数据库连接异常/统计暂不可用」
      expect(data.runsSucceeded).toBeNull()
    } finally {
      await deadPool.end()
    }
  })
})
