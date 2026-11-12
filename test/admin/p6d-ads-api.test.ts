// P6D §5/§10/§十二 广告管理 API 全链路（scratch 库 facai8_p6d_test，真实 route handler 调用）
// - 新建恒 draft / version=1 / AUTO_INCREMENT 十进制字符串 ID / sortOrder 追加末尾
// - strictObject 拒绝 id/status/deletedAt；targetUrl 仅格式校验（SSRF 禁令：保存全程无 fetch）
// - imagePath 服务端存在性校验（缺失文件 / 外链 / SVG → 422）
// - effectiveStatus 只读计算：GET 不回写 DB（scheduled/expired 展示，status 列不变）
// - 状态机 draft→active|expired / active↔disabled / *→expired / expired→active|disabled；
//   同态与非法迁移 422；乐观锁 409（文案固定）；软删除行 404
// - reorder：同 position 作用域（409）、去重、逐行版本、任一失败整批回滚、审计 before/after
// - RBAC 四角色 + CSRF；审计 token 脱敏；403/409/422 无成功审计
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AdDto } from "../../src/lib/admin/dto/ad.ts"
import type { PageResult } from "../../src/lib/admin/dto/content.ts"
import {
  auditJson,
  auditRows,
  countAudit,
  errBody,
  p6dLogin,
  rawQuery,
  reqFor,
  seedAdRaw,
  setupP6dEnv,
  teardownP6dEnv,
  type P6dEnv,
  type P6dSession,
} from "./p6d-harness"

const VERSION_CONFLICT_MSG = "该记录已被其他管理员修改，请刷新后重新编辑"
const IMG = "/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png"
const IMG2 = "/uploads/2026/09/19/22bb856abdab4f4eae80039cee3b3365.png"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; fields?: Record<string, string> }
}
async function body<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>
}

type R1 = (req: Request) => Promise<Response>
type R2 = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })

let env: P6dEnv
let su: P6dSession
let auditor: P6dSession
let editor: P6dSession
let cadmin: P6dSession

let listRoute!: { GET: R1; POST: R1; PUT: () => Promise<Response> }
let itemRoute!: { GET: R2; PATCH: R2; DELETE: R2; POST: R1 }
let statusRoute!: { PATCH: R2 }
let restoreRoute!: { POST: R2 }
let reorderRoute!: { POST: R1 }

const BASE = "/api/admin/v1/ads"

async function createAd(
  title: string,
  opts: { session?: P6dSession; extra?: Record<string, unknown> } = {},
): Promise<{ res: Response; json: Envelope<AdDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", BASE, { title, targetUrl: "https://example.com/land", imagePath: IMG, ...(opts.extra ?? {}) }),
  )
  return { res, json: await body<AdDto>(res) }
}

async function createFull(extra: Record<string, unknown> = {}): Promise<AdDto> {
  const { json } = await createAd(`p6d-ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, { extra })
  if (!json.data) throw new Error(`create failed: ${JSON.stringify(json.error)}`)
  return json.data
}

async function getAd(id: string, session: P6dSession = su): Promise<Envelope<AdDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `${BASE}/${id}`), ctxOf(id)))
}

async function patchAd(id: string, payload: Record<string, unknown>, session: P6dSession = su) {
  const res = await itemRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}`, payload), ctxOf(id))
  return { res, json: await body<AdDto>(res) }
}

async function changeStatus(id: string, status: string, version: number, session: P6dSession = su) {
  const res = await statusRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}/status`, { status, version }), ctxOf(id))
  return { res, json: await body<AdDto>(res) }
}

async function deleteAd(id: string, version: number, session: P6dSession = su) {
  const res = await itemRoute.DELETE(reqFor(session, "DELETE", `${BASE}/${id}?version=${version}`), ctxOf(id))
  return { res, json: await body<AdDto>(res) }
}

async function restoreAd(id: string, version: number, session: P6dSession = su) {
  const res = await restoreRoute.POST(reqFor(session, "POST", `${BASE}/${id}/restore`, { version }), ctxOf(id))
  return { res, json: await body<AdDto>(res) }
}

async function reorder(items: unknown[], position?: string, session: P6dSession = su) {
  const res = await reorderRoute.POST(reqFor(session, "POST", `${BASE}/reorder`, { items, ...(position ? { position } : {}) }))
  return { res, json: await body<{ records: AdDto[] }>(res) }
}

/** ads 表原始行（effectiveStatus 不回写断言用） */
async function rawAd(id: string): Promise<Record<string, unknown>> {
  const rows = await rawQuery(env.pool, "SELECT * FROM ads WHERE id = ?", [id])
  return rows[0]!
}

/** SSRF 断言：保存链路不得发起任何服务端 fetch */
function withFetchSpy<T>(fn: () => Promise<T>): Promise<{ result: T; fetchCalls: number }> {
  return (async () => {
    const orig = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("", { status: 200 })
    }) as unknown as typeof fetch
    try {
      const result = await fn()
      return { result, fetchCalls: calls }
    } finally {
      globalThis.fetch = orig
    }
  })()
}

beforeAll(async () => {
  env = await setupP6dEnv()
  su = await p6dLogin(env, "p6d-su", ["super_admin"])
  auditor = await p6dLogin(env, "p6d-auditor", ["auditor"])
  editor = await p6dLogin(env, "p6d-editor", ["content_editor"])
  cadmin = await p6dLogin(env, "p6d-cadmin", ["content_admin"])

  listRoute = await import("../../src/app/api/admin/v1/ads/route")
  itemRoute = await import("../../src/app/api/admin/v1/ads/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/ads/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/ads/[id]/restore/route")
  reorderRoute = await import("../../src/app/api/admin/v1/ads/reorder/route")
})

afterAll(async () => {
  if (env) await teardownP6dEnv(env)
})

describe("迁移与新建（AUTO_INCREMENT / 恒 draft / 默认值）", () => {
  it("scratch 库迁移含 0005：ads.id 与 site_lines.id 是 AUTO_INCREMENT，site_settings 有 version 列", async () => {
    const cols = await rawQuery<{ t: string; extra: string }>(
      env.pool,
      "SELECT TABLE_NAME AS t, EXTRA AS extra FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN ('ads','site_lines')",
    )
    expect(cols).toHaveLength(2)
    for (const c of cols) expect(c.extra.toLowerCase()).toContain("auto_increment")
    const st = await rawQuery<{ c: number }>(
      env.pool,
      "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_settings' AND COLUMN_NAME = 'version'",
    )
    expect(Number(st[0]!.c)).toBe(1)
  })

  it("POST 新建：恒 draft / version=1 / 十进制字符串自增 ID / 未删除 / 生效状态 draft", async () => {
    const { res, json } = await createAd("自增测试广告")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(d.status).toBe("draft")
    expect(d.effectiveStatus).toBe("draft")
    expect(d.version).toBe(1)
    expect(d.deletedAt).toBeNull()
    expect(d.position).toBe("home")
  })

  it("新建 ID 严格递增（同连接池内不复用历史 ID）", async () => {
    const a = await createFull()
    const b = await createFull()
    expect(BigInt(b.id)).toBeGreaterThan(BigInt(a.id))
  })

  it("sortOrder 省略 = 追加到同 position 有效行最大序之后；显式 sortOrder 尊重传入", async () => {
    const a = await createFull()
    const b = await createFull()
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)
    const c = await createFull({ sortOrder: 4242 })
    expect(c.sortOrder).toBe(4242)
  })

  it("保存全程不发起服务端 fetch（SSRF 禁令，§5.9）", async () => {
    const { fetchCalls } = await withFetchSpy(async () => {
      const ad = await createFull({ targetUrl: "https://traced.example.com/land?token=abc" })
      await patchAd(ad.id, { version: ad.version, targetUrl: "https://traced.example.com/other" })
      await changeStatus(ad.id, "active", ad.version)
    })
    expect(fetchCalls).toBe(0)
  })
})

describe("创建校验（422 字段错误；strictObject 保护字段）", () => {
  it("position allowlist：非 home → 422", async () => {
    const { res, json } = await createAd("位置测试", { extra: { position: "sidebar" } })
    expect(res.status).toBe(422)
    expect(json.error!.fields!.position).toBeTruthy()
  })

  it("标题必填", async () => {
    const res = await listRoute.POST(reqFor(su, "POST", BASE, { targetUrl: "https://e.com", imagePath: IMG }))
    expect(res.status).toBe(422)
    expect((await body(res)).error!.fields!.title).toBeTruthy()
  })

  it("targetUrl：危险协议 / 非 URL / 账号密码一律 422", async () => {
    for (const url of ["javascript:alert(1)", "not a url", "https://u:p@example.com/", "data:text/html;base64,x"]) {
      const { res } = await createAd("URL测试", { extra: { targetUrl: url } })
      expect(res.status, url).toBe(422)
    }
  })

  it("imagePath：外链 / 缺失文件 / SVG 一律 422（服务端存在性校验）", async () => {
    const ext = await createAd("外链图", { extra: { imagePath: "https://cdn.example.com/a.png" } })
    expect(ext.res.status).toBe(422)
    const missing = await createAd("缺失图", { extra: { imagePath: "/sites/facai8/images/nope-missing.png" } })
    expect(missing.res.status).toBe(422)
    expect(missing.json.error!.fields!.imagePath).toContain("不存在")
    const svg = await createAd("SVG图", { extra: { imagePath: "/sites/facai8/images/logo.svg" } })
    expect(svg.res.status).toBe(422)
  })

  it("startsAt 必须早于 endsAt", async () => {
    const { res, json } = await createAd("排期反了", {
      extra: { startsAt: "2026-12-31 23:59:59", endsAt: "2026-01-01 00:00:00" },
    })
    expect(res.status).toBe(422)
    expect(json.error!.fields!.startsAt).toBeTruthy()
  })

  it("客户端不许传 id / status / deletedAt（strictObject）", async () => {
    for (const extra of [{ id: "123" }, { status: "active" }, { deletedAt: null }]) {
      const { res } = await createAd("保护字段", { extra })
      expect(res.status, JSON.stringify(extra)).toBe(422)
    }
  })

  it("sortOrder 非负整数", async () => {
    expect((await createAd("负排序", { extra: { sortOrder: -1 } })).res.status).toBe(422)
  })
})

describe("effectiveStatus 只读计算（GET 不回写 DB）", () => {
  it("active + 未来 startsAt → 展示 scheduled，status 列仍是 active", async () => {
    const id = await seedAdRaw(env.db, { status: "active", startsAt: "2099-01-01 00:00:00.000" })
    const json = await getAd(id)
    expect(json.data!.effectiveStatus).toBe("scheduled")
    expect((await rawAd(id)).status).toBe("active")
  })

  it("active + 已过 endsAt → 展示 expired，status 列仍是 active", async () => {
    const id = await seedAdRaw(env.db, { status: "active", endsAt: "2020-01-01 00:00:00.000" })
    const json = await getAd(id)
    expect(json.data!.effectiveStatus).toBe("expired")
    expect((await rawAd(id)).status).toBe("active")
  })

  it("disabled 优先展示 disabled；draft 恒 draft", async () => {
    const disabled = await seedAdRaw(env.db, { status: "disabled", endsAt: "2020-01-01 00:00:00.000" })
    expect((await getAd(disabled)).data!.effectiveStatus).toBe("disabled")
    const draft = await seedAdRaw(env.db, { status: "draft" })
    expect((await getAd(draft)).data!.effectiveStatus).toBe("draft")
  })
})

describe("PATCH 编辑（乐观锁 / 无 status / 审计差量）", () => {
  it("编辑标题与图片 → 200，version+1，imagePath 换历史 /uploads/ 路径合法", async () => {
    const ad = await createFull()
    const { res, json } = await patchAd(ad.id, { version: ad.version, title: "改名成功", imagePath: IMG2 })
    expect(res.status).toBe(200)
    expect(json.data!.title).toBe("改名成功")
    expect(json.data!.imagePath).toBe(IMG2)
    expect(json.data!.version).toBe(ad.version + 1)
  })

  it("PATCH 不接受 status（状态走独立接口）", async () => {
    const ad = await createFull()
    const { res } = await patchAd(ad.id, { version: ad.version, status: "active" })
    expect(res.status).toBe(422)
  })

  it("PATCH 必须带 version；缺省 422", async () => {
    const ad = await createFull()
    expect((await patchAd(ad.id, { title: "无版本" })).res.status).toBe(422)
  })

  it("version 冲突 → 409 固定文案，值不变，零成功审计", async () => {
    const ad = await createFull()
    const before = await countAudit(env.pool, "ad.update")
    const { res, json } = await patchAd(ad.id, { version: ad.version + 5, title: "冲突编辑" })
    expect(res.status).toBe(409)
    expect(json.error!.code).toBe("VERSION_CONFLICT")
    expect(json.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect((await getAd(ad.id)).data!.title).not.toBe("冲突编辑")
    expect(await countAudit(env.pool, "ad.update")).toBe(before)
  })

  it("PATCH 换缺失文件 / 外链图 → 422，DB 不变", async () => {
    const ad = await createFull()
    const { res } = await patchAd(ad.id, { version: ad.version, imagePath: "/sites/facai8/images/ghost.png" })
    expect(res.status).toBe(422)
    expect((await getAd(ad.id)).data!.imagePath).toBe(IMG)
  })

  it("PATCH 提交与原值完全相同 → 仍 200（version 前进），审计 before/after 无虚差量", async () => {
    const ad = await createFull()
    const { res } = await patchAd(ad.id, { version: ad.version, title: ad.title })
    expect(res.status).toBe(200)
    const rows = await auditRows(env.pool, "ad.update")
    const last = rows[rows.length - 1]!
    expect(auditJson(last.before_json)).not.toHaveProperty("title")
  })

  it("PATCH 排期合并校验：只提交更早的 endsAt 使其早于既有 startsAt → 422", async () => {
    const id = await seedAdRaw(env.db, { startsAt: "2026-06-01 00:00:00.000", endsAt: "2026-12-01 00:00:00.000" })
    const v = Number((await rawAd(id)).version)
    const { res } = await patchAd(id, { version: v, endsAt: "2026-05-01 00:00:00" })
    expect(res.status).toBe(422)
  })

  it("targetUrl 审计快照 token 参数脱敏（§十二-2）", async () => {
    const ad = await createFull()
    await patchAd(ad.id, { version: ad.version, targetUrl: "https://e.com/land?token=S3CR3TVAL&x=1" })
    const rows = await auditRows(env.pool, "ad.update")
    const last = rows[rows.length - 1]!
    const after = auditJson(last.after_json)
    expect(after.target_url).toContain("token=***")
    expect(after.target_url).not.toContain("S3CR3TVAL")
    expect(after.target_url).toContain("x=1")
  })
})

describe("状态机（/status；ad.enable / ad.disable / ad.expire）", () => {
  it("draft→active→disabled→active→expired→disabled 全链路合法", async () => {
    let ad = (await createFull())
    let res = await changeStatus(ad.id, "active", ad.version)
    expect(res.res.status).toBe(200)
    expect(res.json.data!.status).toBe("active")
    expect(res.json.data!.version).toBe(ad.version + 1)
    ad = res.json.data!
    res = await changeStatus(ad.id, "disabled", ad.version)
    expect(res.res.status).toBe(200)
    ad = res.json.data!
    res = await changeStatus(ad.id, "active", ad.version)
    expect(res.res.status).toBe(200)
    ad = res.json.data!
    res = await changeStatus(ad.id, "expired", ad.version)
    expect(res.res.status).toBe(200)
    expect(res.json.data!.effectiveStatus).toBe("expired")
    ad = res.json.data!
    res = await changeStatus(ad.id, "disabled", ad.version)
    expect(res.res.status).toBe(200)
  })

  it("draft→disabled 非法 → 422 AD_STATUS_TRANSITION", async () => {
    const ad = await createFull()
    const { res, json } = await changeStatus(ad.id, "disabled", ad.version)
    expect(res.status).toBe(422)
    expect(json.error!.code).toBe("AD_STATUS_TRANSITION")
  })

  it("同态切换 → 422；draft 不是合法目标（schema）→ 422", async () => {
    const ad = await createFull()
    await changeStatus(ad.id, "active", ad.version)
    const again = await changeStatus(ad.id, "active", ad.version) // version 已+1，这里用旧 version → 409
    expect(again.res.status).toBe(409)
    const fresh = await getAd(ad.id)
    const same = await changeStatus(ad.id, "active", fresh.data!.version)
    expect(same.res.status).toBe(422)
    expect((await changeStatus(ad.id, "draft", fresh.data!.version)).res.status).toBe(422)
  })

  it("状态切换 version 冲突 → 409 固定文案，status 不变", async () => {
    const ad = await createFull()
    const { res, json } = await changeStatus(ad.id, "active", ad.version + 9)
    expect(res.status).toBe(409)
    expect(json.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect((await getAd(ad.id)).data!.status).toBe("draft")
  })

  it("软删除行做状态切换 → 404", async () => {
    const id = await seedAdRaw(env.db, { status: "active", deleted: true })
    const v = Number((await rawAd(id)).version)
    const { res } = await changeStatus(id, "disabled", v)
    expect(res.status).toBe(404)
  })

  it("enable/disable/expire 各自审计且只记 status 差量", async () => {
    const ad = await createFull()
    await changeStatus(ad.id, "active", ad.version)
    await auditRows(env.pool, "ad.enable").then((rows) => {
      expect(rows.length).toBeGreaterThan(0)
      expect(auditJson(rows[rows.length - 1]!.after_json).status).toBe("active")
    })
    const enabled = await getAd(ad.id)
    await changeStatus(ad.id, "disabled", enabled.data!.version)
    await auditRows(env.pool, "ad.disable").then((rows) => {
      expect(auditJson(rows[rows.length - 1]!.after_json).status).toBe("disabled")
    })
    const disabled = await getAd(ad.id)
    await changeStatus(ad.id, "expired", disabled.data!.version)
    await auditRows(env.pool, "ad.expire").then((rows) => {
      expect(auditJson(rows[rows.length - 1]!.after_json).status).toBe("expired")
    })
  })
})

describe("批量排序（POST /ads/reorder；同 position 作用域）", () => {
  it("三条重排成功 → sortOrder 生效、逐行 version+1、审计前后 items", async () => {
    const a = await createFull()
    const b = await createFull()
    const c = await createFull()
    const { res, json } = await reorder([
      { id: c.id, sortOrder: 10, version: c.version },
      { id: b.id, sortOrder: 20, version: b.version },
      { id: a.id, sortOrder: 30, version: a.version },
    ])
    expect(res.status).toBe(200)
    const byId = new Map(json.data!.records.map((r) => [r.id, r]))
    expect(byId.get(c.id)!.sortOrder).toBe(10)
    expect(byId.get(a.id)!.sortOrder).toBe(30)
    expect(byId.get(c.id)!.version).toBe(c.version + 1)
    const rows = await auditRows(env.pool, "ad.reorder")
    const last = rows[rows.length - 1]!
    expect(last.resource_id).toBe("position:home")
    const before = auditJson(last.before_json).items as { id: string; sort_order: number }[]
    const after = auditJson(last.after_json).items as { id: string; sort_order: number }[]
    expect(before.map((i) => i.sort_order)).not.toEqual(after.map((i) => i.sort_order))
    expect(after.find((i) => i.id === c.id)!.sort_order).toBe(10)
  })

  it("显式 position=home 作用域一致通过", async () => {
    const a = await createFull()
    const b = await createFull()
    const { res } = await reorder(
      [
        { id: a.id, sortOrder: 1, version: a.version },
        { id: b.id, sortOrder: 2, version: b.version },
      ],
      "home",
    )
    expect(res.status).toBe(200)
  })

  it("id 重复 → 422；空数组 → 422", async () => {
    const a = await createFull()
    const dup = await reorder([
      { id: a.id, sortOrder: 1, version: a.version },
      { id: a.id, sortOrder: 2, version: a.version },
    ])
    expect(dup.res.status).toBe(422)
    expect((await reorder([])).res.status).toBe(422)
  })

  it("跨 position（历史遗留 internal 行）→ 409 REORDER_SCOPE_MISMATCH", async () => {
    const home = await createFull()
    const legacy = await seedAdRaw(env.db, { position: "internal", status: "active" })
    const lv = Number((await rawAd(legacy)).version)
    const { res, json } = await reorder([
      { id: home.id, sortOrder: 1, version: home.version },
      { id: legacy, sortOrder: 2, version: lv },
    ])
    expect(res.status).toBe(409)
    expect(json.error!.code).toBe("REORDER_SCOPE_MISMATCH")
  })

  it("任一行版本冲突 → 整批回滚（先处理的行也不落库）", async () => {
    const a = await createFull()
    const b = await createFull()
    const { res } = await reorder([
      { id: a.id, sortOrder: 999, version: a.version },
      { id: b.id, sortOrder: 998, version: b.version + 7 },
    ])
    expect(res.status).toBe(409)
    expect((await getAd(a.id)).data!.sortOrder).not.toBe(999)
  })

  it("包含软删除行 → 404 且整批回滚", async () => {
    const a = await createFull()
    const gone = await seedAdRaw(env.db, { deleted: true })
    const gv = Number((await rawAd(gone)).version)
    const { res } = await reorder([
      { id: a.id, sortOrder: 777, version: a.version },
      { id: gone, sortOrder: 776, version: gv },
    ])
    expect(res.status).toBe(404)
    expect((await getAd(a.id)).data!.sortOrder).not.toBe(777)
  })
})

describe("软删除与恢复", () => {
  it("DELETE ?version= → 软删除，deletedAt 出现，列表默认隐藏、includeDeleted 可见", async () => {
    const ad = await createFull()
    const { res, json } = await deleteAd(ad.id, ad.version)
    expect(res.status).toBe(200)
    expect(json.data!.deletedAt).toBeTruthy()
    const list = await body<PageResult<AdDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=${encodeURIComponent(ad.title)}`)))
    expect(list.data!.items.some((i) => i.id === ad.id)).toBe(false)
    const listAll = await body<PageResult<AdDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=${encodeURIComponent(ad.title)}&includeDeleted=true`)),
    )
    expect(listAll.data!.items.some((i) => i.id === ad.id)).toBe(true)
    const rows = await auditRows(env.pool, "ad.soft_delete")
    expect(auditJson(rows[rows.length - 1]!.before_json).deleted_at).toBeNull()
  })

  it("重复 DELETE / 缺 version 参数 / 错 version → 404、422、409", async () => {
    const ad = await createFull()
    await deleteAd(ad.id, ad.version)
    expect((await deleteAd(ad.id, ad.version)).res.status).toBe(404)
    const bare = await itemRoute.DELETE(reqFor(su, "DELETE", `${BASE}/${ad.id}`), ctxOf(ad.id))
    expect(bare.status).toBe(422)
    const other = await createFull()
    expect((await deleteAd(other.id, other.version + 3)).res.status).toBe(409)
  })

  it("恢复：保留原状态/排序/排期，清 deletedAt，审计 ad.restore", async () => {
    const id = await seedAdRaw(env.db, {
      status: "active",
      sortOrder: 55,
      startsAt: "2026-06-01 00:00:00.000",
      endsAt: "2026-12-01 00:00:00.000",
      deleted: true,
    })
    const v = Number((await rawAd(id)).version)
    const { res, json } = await restoreAd(id, v)
    expect(res.status).toBe(200)
    expect(json.data!.deletedAt).toBeNull()
    expect(json.data!.status).toBe("active")
    expect(json.data!.sortOrder).toBe(55)
    expect(json.data!.startsAt).toBe("2026-06-01 00:00:00.000")
    const rows = await auditRows(env.pool, "ad.restore")
    expect(auditJson(rows[rows.length - 1]!.before_json).deleted_at).toBeTruthy()
  })

  it("未删除行 restore → 422；错 version → 409", async () => {
    const ad = await createFull()
    expect((await restoreAd(ad.id, ad.version)).res.status).toBe(422)
    const id = await seedAdRaw(env.db, { deleted: true })
    expect((await restoreAd(id, 999)).res.status).toBe(409)
  })
})

describe("列表查询与路由杂项", () => {
  it("列表默认按 sortOrder asc，分页合同 pageSize 只允许 20/50/100", async () => {
    const ok = await listRoute.GET(reqFor(su, "GET", `${BASE}?pageSize=50`))
    expect(ok.status).toBe(200)
    const bad = await listRoute.GET(reqFor(su, "GET", `${BASE}?pageSize=7`))
    expect(bad.status).toBe(422)
    const sort = await listRoute.GET(reqFor(su, "GET", `${BASE}?sortBy=bogus`))
    expect(sort.status).toBe(422)
  })

  it("status 过滤是 DB 枚举四值", async () => {
    for (const s of ["draft", "active", "disabled", "expired"]) {
      expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?status=${s}`))).status).toBe(200)
    }
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?status=published`))).status).toBe(422)
  })

  it("非法 ID 段 → 422；未知 ID → 404", async () => {
    expect((await itemRoute.GET(reqFor(su, "GET", `${BASE}/abc`), ctxOf("abc"))).status).toBe(422)
    expect((await itemRoute.GET(reqFor(su, "GET", `${BASE}/999999999999999999`), ctxOf("999999999999999999"))).status).toBe(404)
  })

  it("GET 不支持的方法 → 405（PUT 段导出 methodNotAllowed）", async () => {
    expect((await listRoute.PUT()).status).toBe(405)
  })
})

describe("认证 / CSRF / RBAC（API 强制，§九）", () => {
  it("未登录：GET 401、POST 401", async () => {
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noAuth: true }))).status).toBe(401)
    expect((await listRoute.POST(reqFor(su, "POST", BASE, { title: "x" }, { noAuth: true }))).status).toBe(401)
  })

  it("缺 CSRF：写操作 403 CSRF_INVALID，GET 不受影响", async () => {
    const res = await listRoute.POST(reqFor(su, "POST", BASE, { title: "无csrf", targetUrl: "https://e.com", imagePath: IMG }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("CSRF_INVALID")
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noCsrf: true }))).status).toBe(200)
  })

  it("auditor 只读：GET 200，全部写路径 403 且零成功审计", async () => {
    expect((await listRoute.GET(reqFor(auditor, "GET", BASE))).status).toBe(200)
    const ad = await createFull()
    const before = await countAudit(env.pool, "ad.create")
    expect((await createAd("审计写", { session: auditor })).res.status).toBe(403)
    expect((await patchAd(ad.id, { version: ad.version, title: "审计改" }, auditor)).res.status).toBe(403)
    expect((await changeStatus(ad.id, "active", ad.version, auditor)).res.status).toBe(403)
    expect((await deleteAd(ad.id, ad.version, auditor)).res.status).toBe(403)
    expect((await restoreAd(ad.id, ad.version, auditor)).res.status).toBe(403)
    expect((await reorder([{ id: ad.id, sortOrder: 1, version: ad.version }], undefined, auditor)).res.status).toBe(403)
    expect(await countAudit(env.pool, "ad.create")).toBe(before)
  })

  it("content_editor 无 delete：建/改/启停/排序 200，删除与恢复 403", async () => {
    const { res, json } = await createAd("编辑者建", { session: editor })
    expect(res.status).toBe(200)
    const ad = json.data!
    expect((await patchAd(ad.id, { version: ad.version, title: "编辑者改" }, editor)).res.status).toBe(200)
    const updated = await getAd(ad.id)
    expect((await changeStatus(ad.id, "active", updated.data!.version, editor)).res.status).toBe(200)
    const enabled = await getAd(ad.id)
    expect((await reorder([{ id: ad.id, sortOrder: 3, version: enabled.data!.version }], undefined, editor)).res.status).toBe(200)
    const fresh = await getAd(ad.id)
    expect((await deleteAd(ad.id, fresh.data!.version, editor)).res.status).toBe(403)
    expect((await restoreAd(ad.id, fresh.data!.version, editor)).res.status).toBe(403)
  })

  it("content_admin 拥有 ads.delete：删除+恢复闭环 200", async () => {
    const { json } = await createAd("cadmin删除", { session: cadmin })
    const ad = json.data!
    expect((await deleteAd(ad.id, ad.version, cadmin)).res.status).toBe(200)
    const deleted = await getAd(ad.id)
    expect((await restoreAd(ad.id, deleted.data!.version, cadmin)).res.status).toBe(200)
  })
})
