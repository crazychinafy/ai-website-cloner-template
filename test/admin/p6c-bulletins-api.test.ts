// P6C §14 公告管理 API 全链路（scratch 库 facai8_p6c_test，真实 route handler 调用）
// - 新建合同：恒 draft / sortOrder 省略=有效行 max+1 / 正文服务端净化
// - 状态机与文章一致（published→draft 撤回禁止）；publishedAt 首发写一次
// - reorder：单事务逐行版本、任一失败整批回滚、审计 before/after 排序表、Zod ID 去重
// - 软删除保留状态、恢复无外部依赖（published 直接恢复）；列表默认 sortOrder ASC + id DESC
// - RBAC：editor 可排序（bulletins.update）但不能发布/删除/恢复；auditor 只读
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import type { BulletinDto, PageResult } from "../../src/lib/admin/dto/bulletin.ts"
import {
  auditJson,
  auditRows,
  countAudit,
  errBody,
  p6cLogin,
  rawQuery,
  reqFor,
  seedBulletinRaw,
  setupP6cEnv,
  teardownP6cEnv,
  type P6cEnv,
  type P6cSession,
} from "./p6c-harness"

const VERSION_CONFLICT_MSG = "该记录已被其他管理员修改，请刷新后重新编辑"

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

let env: P6cEnv
let su: P6cSession
let auditor: P6cSession
let editor: P6cSession
let cadmin: P6cSession

let listRoute: { GET: R1; POST: R1; PUT: R1 }
let itemRoute: { GET: R2; PATCH: R2; DELETE: R2; POST: R1 }
let statusRoute: { PATCH: R2; GET: R1 }
let restoreRoute: { POST: R2; GET: R1 }
let reorderRoute: { POST: R1; GET: R1 }

const BASE = "/api/admin/v1/bulletins"

async function createBulletin(
  title: string,
  opts: { session?: P6cSession; extra?: Record<string, unknown> } = {},
): Promise<{ res: Response; json: Envelope<BulletinDto> }> {
  const res = await listRoute.POST(reqFor(opts.session ?? su, "POST", BASE, { title, ...(opts.extra ?? {}) }))
  return { res, json: await body<BulletinDto>(res) }
}

async function getBulletin(id: string, session: P6cSession = su): Promise<Envelope<BulletinDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `${BASE}/${id}`), ctxOf(id)))
}

async function patchBulletin(
  id: string,
  payload: Record<string, unknown>,
  session: P6cSession = su,
): Promise<{ res: Response; json: Envelope<BulletinDto> }> {
  const res = await itemRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}`, payload), ctxOf(id))
  return { res, json: await body<BulletinDto>(res) }
}

async function patchStatus(
  id: string,
  status: string,
  version: number,
  session: P6cSession = su,
): Promise<{ res: Response; json: Envelope<BulletinDto> }> {
  const res = await statusRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}/status`, { status, version }), ctxOf(id))
  return { res, json: await body<BulletinDto>(res) }
}

async function deleteBulletin(id: string, version: number, session: P6cSession = su): Promise<Response> {
  return itemRoute.DELETE(reqFor(session, "DELETE", `${BASE}/${id}?version=${version}`), ctxOf(id))
}

async function restoreBulletin(id: string, version: number, session: P6cSession = su): Promise<Response> {
  return restoreRoute.POST(reqFor(session, "POST", `${BASE}/${id}/restore`, { version }), ctxOf(id))
}

async function reorder(
  items: Array<{ id: string; sortOrder: number; version: number }>,
  session: P6cSession = su,
): Promise<{ res: Response; json: Envelope<{ records: BulletinDto[] }> }> {
  const res = await reorderRoute.POST(reqFor(session, "POST", `${BASE}/reorder`, { items }))
  return { res, json: await body<{ records: BulletinDto[] }>(res) }
}

async function dbRow(id: string): Promise<Record<string, unknown>> {
  const rows = await rawQuery(env.pool, "SELECT * FROM bulletins WHERE id = ?", [id])
  return rows[0]!
}

async function countAllAudit(): Promise<number> {
  const rows = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM admin_audit_logs")
  return Number(rows[0]!.n)
}

beforeAll(async () => {
  env = await setupP6cEnv()
  su = await p6cLogin(env, "p6c_bulletin_super", ["super_admin"])
  auditor = await p6cLogin(env, "p6c_bulletin_auditor", ["auditor"])
  editor = await p6cLogin(env, "p6c_bulletin_editor", ["content_editor"])
  cadmin = await p6cLogin(env, "p6c_bulletin_cadmin", ["content_admin"])

  listRoute = await import("../../src/app/api/admin/v1/bulletins/route")
  itemRoute = await import("../../src/app/api/admin/v1/bulletins/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/bulletins/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/bulletins/[id]/restore/route")
  reorderRoute = await import("../../src/app/api/admin/v1/bulletins/reorder/route")
}, 240_000)

afterAll(async () => {
  await teardownP6cEnv(env)
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：新建合同（POST /bulletins）", () => {
  it("最小新建：draft / AUTO_INCREMENT 字符串 ID / version 1 / 空正文", async () => {
    const { res, json } = await createBulletin("p6cB_最小新建")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9]\d*$/)
    expect(d.status).toBe("draft")
    expect(d.version).toBe(1)
    expect(d.publishedAt).toBeNull()
    expect(d.deletedAt).toBeNull()
    expect(d.contentHtml).toBe("")
    expect(d.title).toBe("p6cB_最小新建")
  })

  it("sortOrder 省略 = 有效行 max+1 递增；显式 sortOrder 照单收下；软删行不抬高基准", async () => {
    const first = (await createBulletin("p6cB_追加1")).json.data!
    const second = (await createBulletin("p6cB_追加2")).json.data!
    expect(second.sortOrder).toBe(first.sortOrder + 1)

    // 置顶语义：显式 0 新建排最前
    const top = (await createBulletin("p6cB_置顶", { extra: { sortOrder: 0 } })).json.data!
    expect(top.sortOrder).toBe(0)

    // 软删高排序行后，新追加行 = 有效行 max+1（不被已删行抬高）
    await seedBulletinRaw(env.db, { title: "p6cB_已删高排序", sortOrder: 9_999, deleted: true })
    const next = (await createBulletin("p6cB_追加3")).json.data!
    expect(next.sortOrder).toBe(second.sortOrder + 1)
  })

  it("正文服务端净化入库（onclick/script 剥离）", async () => {
    const { json } = await createBulletin("p6cB_净化入库", {
      extra: { contentHtml: '<p onclick="alert(1)">Hi</p><script>alert(2)</script>' },
    })
    expect(json.data!.contentHtml).toBe("<p>Hi</p>")
    expect(String((await dbRow(json.data!.id)).content_html)).toBe("<p>Hi</p>")
  })

  it("受保护字段出现在 body → 422（status/viewCount/publishedAt/deletedAt）", async () => {
    for (const field of ["status", "publishedAt", "deletedAt", "version"]) {
      const res = await listRoute.POST(reqFor(su, "POST", BASE, { title: "p6cB_受保护", [field]: "x" }))
      const e = await errBody(res)
      expect(res.status, field).toBe(422)
      expect(e.error.code, field).toBe("VALIDATION_ERROR")
      expect(Object.values(e.error.fields ?? {}).join(" "), field).toContain(field)
    }
  })

  it("字段校验：标题空/超长、sortOrder 负数/小数/超 INT 上限、正文超长 → 422", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: "" }, "title"],
      [{ title: "x".repeat(501) }, "title"],
      [{ title: "p6cB_负排序", sortOrder: -1 }, "sortOrder"],
      [{ title: "p6cB_小数排序", sortOrder: 1.5 }, "sortOrder"],
      [{ title: "p6cB_超大排序", sortOrder: 2_147_483_648 }, "sortOrder"],
      [{ title: "p6cB_超长正文", contentHtml: "x".repeat(100_001) }, "contentHtml"],
    ]
    for (const [payload, field] of cases) {
      const res = await listRoute.POST(reqFor(su, "POST", BASE, payload))
      const e = await errBody(res)
      expect(res.status, JSON.stringify(payload).slice(0, 60)).toBe(422)
      expect(e.error.fields?.[field] ?? Object.values(e.error.fields ?? {}).join(" "), field).toBeTruthy()
    }
  })

  it("CSRF / 未认证 / 方法不允许", async () => {
    const noCsrf = await listRoute.POST(reqFor(su, "POST", BASE, { title: "p6cB_csrf" }, { noCsrf: true }))
    expect(noCsrf.status).toBe(403)
    expect((await errBody(noCsrf)).error.code).toBe("CSRF_INVALID")
    const anon = await listRoute.POST(reqFor(su, "POST", BASE, { title: "p6cB_anon" }, { noAuth: true }))
    expect(anon.status).toBe(401)
    expect((await listRoute.PUT(reqFor(su, "GET", BASE))).status).toBe(405)
  })

  it("bulletin.create 审计：resource_type=bulletin / 正文只存 digest", async () => {
    const { json } = await createBulletin("p6cB_审计新建", { extra: { contentHtml: "<p>正文</p>" } })
    const rows = await auditRows(env.pool, "bulletin.create")
    const row = rows.find((r) => r.resource_id === json.data!.id)
    expect(row).toBeTruthy()
    expect(row!.actor_user_id).toBe(String(su.admin.id))
    expect(row!.resource_type).toBe("bulletin")
    const after = auditJson(row!.after_json)
    expect(after.title).toBe("p6cB_审计新建")
    expect(after.status).toBe("draft")
    expect(after.contentHtml.sha256).toBe(createHash("sha256").update("<p>正文</p>", "utf8").digest("hex"))
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：详情与列表（GET）", () => {
  let bA: BulletinDto
  beforeAll(async () => {
    bA = (await createBulletin("p6cB_详情样本")).json.data!
  })

  it("GET 详情：DTO 字段合同", async () => {
    const d = (await getBulletin(bA.id)).data!
    expect(d.id).toBe(bA.id)
    expect(typeof d.sortOrder).toBe("number")
    expect(d.createdAt).toBeTruthy()
    expect(d.updatedAt).toBeTruthy()
  })

  it("ID 非法 422；不存在 404 BULLETIN_NOT_FOUND；软删除行 GET 仍可见", async () => {
    expect((await itemRoute.GET(reqFor(su, "GET", `${BASE}/1e5`), ctxOf("1e5"))).status).toBe(422)
    const gone = await itemRoute.GET(reqFor(su, "GET", `${BASE}/999999999997`), ctxOf("999999999997"))
    expect(gone.status).toBe(404)
    expect((await body<BulletinDto>(gone)).error!.code).toBe("BULLETIN_NOT_FOUND")

    const seeded = await seedBulletinRaw(env.db, { title: "p6cB_种子已删", deleted: true })
    const del = await itemRoute.GET(reqFor(su, "GET", `${BASE}/${seeded}`), ctxOf(seeded))
    expect(del.status).toBe(200)
    expect((await body<BulletinDto>(del)).data!.deletedAt).toBeTruthy()
  })

  it("列表：q 命中标题；status 过滤", async () => {
    await seedBulletinRaw(env.db, { title: "p6cBQ_甲公告" })
    await seedBulletinRaw(env.db, { title: "p6cBQ_乙公告", status: "published" })
    const byQ = await body<PageResult<BulletinDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cBQ_甲`)))
    expect(byQ.data!.items.map((i) => i.title)).toEqual(["p6cBQ_甲公告"])
    const byStatus = await body<PageResult<BulletinDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cBQ_&status=published`)),
    )
    expect(byStatus.data!.items.map((i) => i.title)).toEqual(["p6cBQ_乙公告"])
  })

  it("列表：默认排除软删除；includeDeleted=true 含已删", async () => {
    const normal = await body<PageResult<BulletinDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cB_种子已删`)))
    expect(normal.data!.items).toHaveLength(0)
    const trash = await body<PageResult<BulletinDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cB_种子已删&includeDeleted=true`)),
    )
    expect(trash.data!.items.map((i) => i.title)).toContain("p6cB_种子已删")
  })

  it("列表：默认 sortOrder ASC，并列时 id DESC 兜底", async () => {
    await seedBulletinRaw(env.db, { title: "p6cBT_并列1", sortOrder: 7_700_001 })
    await seedBulletinRaw(env.db, { title: "p6cBT_并列2", sortOrder: 7_700_001 })
    const list = await body<PageResult<BulletinDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cBT_并列`)))
    const items = list.data!.items
    expect(items).toHaveLength(2)
    // 并列 sortOrder → id 大的（后 seed 的 并列2）在前
    expect(items[0]!.title).toBe("p6cBT_并列2")
    expect(items[1]!.title).toBe("p6cBT_并列1")
    // 全列表 sortOrder 单调不减
    const all = await body<PageResult<BulletinDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?pageSize=100`)))
    const orders = all.data!.items.map((i) => i.sortOrder)
    for (let i = 1; i < orders.length; i++) expect(orders[i]! >= orders[i - 1]!).toBe(true)
  })

  it("列表：分页回显；pageSize=30 / page=0 / 非法枚举 → 422", async () => {
    const p1 = await body<PageResult<BulletinDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cBQ_&pageSize=20`)))
    expect(p1.data!.page).toBe(1)
    expect(p1.data!.pageSize).toBe(20)
    for (const qs of ["pageSize=30", "page=0", "sortBy=zzz", "status=drafting", "includeDeleted=yes"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `${BASE}?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：编辑（PATCH，无 status）", () => {
  it("改标题/sortOrder：版本 +1；审计记 before/after 排序值", async () => {
    const { json } = await createBulletin("p6cB_编辑前")
    const id = json.data!.id
    const before = json.data!
    const { res, json: upd } = await patchBulletin(id, { title: "p6cB_编辑后", sortOrder: 42, version: before.version })
    expect(res.status).toBe(200)
    expect(upd.data!.title).toBe("p6cB_编辑后")
    expect(upd.data!.sortOrder).toBe(42)
    expect(upd.data!.version).toBe(before.version + 1)
    const rows = await auditRows(env.pool, "bulletin.update")
    const row = rows.filter((r) => r.resource_id === id).at(-1)!
    expect(auditJson(row.before_json).sortOrder).toBe(before.sortOrder)
    expect(auditJson(row.after_json).sortOrder).toBe(42)
  })

  it("正文 PATCH 净化入库；净化后与库内一致的正文不产生 contentHtml 审计 diff", async () => {
    const { json } = await createBulletin("p6cB_正文净化PATCH", { extra: { contentHtml: '<p onclick="x()">保留</p>' } })
    const id = json.data!.id
    const { res, json: upd } = await patchBulletin(id, { contentHtml: "<script>bad</script><p>保留</p>", version: json.data!.version })
    expect(res.status).toBe(200)
    expect(upd.data!.contentHtml).toBe("<p>保留</p>")
    const rows = await auditRows(env.pool, "bulletin.update")
    const row = rows.filter((r) => r.resource_id === id).at(-1)!
    expect(auditJson(row.after_json).contentHtml).toBeUndefined()
  })

  it("乐观锁：旧 version → 409 VERSION_CONFLICT 且无部分写入", async () => {
    const { json } = await createBulletin("p6cB_版本冲突")
    const id = json.data!.id
    await patchBulletin(id, { title: "p6cB_第一次改", version: json.data!.version })
    const { res, json: bad } = await patchBulletin(id, { title: "p6cB_第二次改", version: json.data!.version })
    expect(res.status).toBe(409)
    expect(bad.error!.code).toBe("VERSION_CONFLICT")
    expect(bad.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect(String((await dbRow(id)).title)).toBe("p6cB_第一次改")
  })

  it("受保护字段（status 等）进 PATCH → 422；只带 version → 422「没有需要修改的字段」", async () => {
    const { json } = await createBulletin("p6cB_PATCH受保护")
    const id = json.data!.id
    for (const field of ["status", "publishedAt", "deletedAt"]) {
      const { res } = await patchBulletin(id, { [field]: "x", version: json.data!.version })
      expect(res.status, field).toBe(422)
    }
    const empty = await patchBulletin(id, { version: json.data!.version })
    expect(empty.res.status).toBe(422)
    const emptyErr = empty.json.error!
    expect(`${emptyErr.message} ${Object.values(emptyErr.fields ?? {}).join(" ")}`).toContain("没有需要修改的字段")
  })

  it("软删除行 / 幽灵 ID PATCH → 404", async () => {
    const seeded = await seedBulletinRaw(env.db, { title: "p6cB_已删改", deleted: true })
    expect((await patchBulletin(seeded, { title: "p6cB_改不动", version: 1 })).res.status).toBe(404)
    expect((await patchBulletin("999999999996", { title: "p6cB_改幽灵", version: 1 })).res.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：状态机（PATCH /status，bulletins.publish）", () => {
  it("矩阵：draft→published / draft→archived / archived→published 放行；published→draft 撤回 422", async () => {
    const a = (await createBulletin("p6cB_矩阵A", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    const pubA = await patchStatus(a.id, "published", a.version)
    expect(pubA.res.status).toBe(200)
    expect(pubA.json.data!.status).toBe("published")

    const b = (await createBulletin("p6cB_矩阵B", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    const archB = await patchStatus(b.id, "archived", b.version)
    expect(archB.res.status).toBe(200)
    const repub = await patchStatus(b.id, "published", archB.json.data!.version)
    expect(repub.res.status).toBe(200)
    expect(repub.json.data!.status).toBe("published")

    const back = await patchStatus(a.id, "draft", pubA.json.data!.version)
    expect(back.res.status).toBe(422)
    expect(back.json.error!.code).toBe("BULLETIN_STATUS_TRANSITION")
    expect(back.json.error!.message).toBe("不允许从已发布变更为草稿（已归档的公告可直接再发布）")
  })

  it("同态切换 422「公告已处于草稿状态」；非法枚举/缺 version 422", async () => {
    const a = (await createBulletin("p6cB_同态")).json.data!
    const same = await patchStatus(a.id, "draft", a.version)
    expect(same.res.status).toBe(422)
    expect(same.json.error!.message).toBe("公告已处于草稿状态")
    expect(
      (await statusRoute.PATCH(reqFor(su, "PATCH", `${BASE}/${a.id}/status`, { status: "pending", version: a.version }), ctxOf(a.id))).status,
    ).toBe(422)
    expect(
      (await statusRoute.PATCH(reqFor(su, "PATCH", `${BASE}/${a.id}/status`, { status: "published" }), ctxOf(a.id))).status,
    ).toBe(422)
  })

  it("发布闸门：正文净化后为空 422「正文为空，不能发布」（无审计、状态不变）", async () => {
    const { json } = await createBulletin("p6cB_空正文发布", { extra: { contentHtml: "<script>alert(1)</script>" } })
    const auditBefore = await countAudit(env.pool, "bulletin.publish")
    const st = await patchStatus(json.data!.id, "published", json.data!.version)
    expect(st.res.status).toBe(422)
    expect(st.json.error!.message).toBe("正文为空，不能发布")
    expect(String((await dbRow(json.data!.id)).status)).toBe("draft")
    expect(await countAudit(env.pool, "bulletin.publish")).toBe(auditBefore)
  })

  it("发布闸门顺带收敛历史脏正文（publish 即清洗，同事务写回）", async () => {
    const legacy = '<p onclick="alert(1)">历史正文</p><script>bad()</script>'
    const id = await seedBulletinRaw(env.db, { title: "p6cB_历史脏正文", contentHtml: legacy })
    const { res, json } = await patchStatus(id, "published", 1)
    expect(res.status).toBe(200)
    expect(json.data!.contentHtml).toBe("<p>历史正文</p>")
    expect(String((await dbRow(id)).content_html)).toBe("<p>历史正文</p>")
  })

  it("publishedAt：草稿 null；首发写入；归档/再发布/编辑不覆盖", async () => {
    let d = (await createBulletin("p6cB_发布时间语义", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    expect(d.publishedAt).toBeNull()
    d = (await patchStatus(d.id, "published", d.version)).json.data!
    const first = d.publishedAt!
    expect(first).toMatch(/^2026-/)
    d = (await patchStatus(d.id, "archived", d.version)).json.data!
    expect(d.publishedAt).toBe(first)
    d = (await patchBulletin(d.id, { title: "p6cB_发布时间语义2", version: d.version })).json.data!
    expect(d.publishedAt).toBe(first)
    d = (await patchStatus(d.id, "published", d.version)).json.data!
    expect(d.publishedAt).toBe(first)
  })

  it("status 端点：软删行 404；旧 version 409；GET → 405", async () => {
    const seeded = await seedBulletinRaw(env.db, { title: "p6cB_已删发布", deleted: true })
    expect((await patchStatus(seeded, "published", 1)).res.status).toBe(404)
    const a = (await createBulletin("p6cB_status版本", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    expect((await patchStatus(a.id, "published", 99)).res.status).toBe(409)
    expect((await statusRoute.GET(reqFor(su, "GET", `${BASE}/${a.id}/status`))).status).toBe(405)
  })

  it("bulletin.publish / bulletin.archive 审计（before.status 语义正确）", async () => {
    const { json } = await createBulletin("p6cB_状态审计", { extra: { contentHtml: "<p>正文</p>" } })
    const id = json.data!.id
    const d = (await patchStatus(id, "published", json.data!.version)).json.data!
    expect((await patchStatus(id, "archived", d.version)).json.data!.status).toBe("archived")
    const pub = (await auditRows(env.pool, "bulletin.publish")).find((r) => r.resource_id === id)!
    const arch = (await auditRows(env.pool, "bulletin.archive")).find((r) => r.resource_id === id)!
    expect(auditJson(pub.before_json).status).toBe("draft")
    expect(auditJson(pub.after_json).status).toBe("published")
    expect(auditJson(arch.before_json).status).toBe("published")
    expect(auditJson(arch.after_json).status).toBe("archived")
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：批量排序（POST /bulletins/reorder）", () => {
  it("成功：sortOrder 全部写入、版本逐行 +1、返回 records、审计记 before/after 排序表", async () => {
    const x = (await createBulletin("p6cB_排序X")).json.data!
    const y = (await createBulletin("p6cB_排序Y")).json.data!
    const { res, json } = await reorder([
      { id: x.id, sortOrder: 2, version: x.version },
      { id: y.id, sortOrder: 1, version: y.version },
    ])
    expect(res.status).toBe(200)
    const records = json.data!.records
    expect(records.find((r) => r.id === x.id)!.sortOrder).toBe(2)
    expect(records.find((r) => r.id === x.id)!.version).toBe(x.version + 1)
    expect(records.find((r) => r.id === y.id)!.sortOrder).toBe(1)
    expect(String((await dbRow(x.id)).sort_order)).toBe("2")

    const rows = await auditRows(env.pool, "bulletin.reorder")
    const row = rows.at(-1)!
    expect(row.resource_id).toBe("global")
    expect(auditJson(row.before_json).items).toEqual([
      { id: x.id, sort_order: x.sortOrder },
      { id: y.id, sort_order: y.sortOrder },
    ])
    expect(auditJson(row.after_json).items).toEqual([
      { id: x.id, sort_order: 2 },
      { id: y.id, sort_order: 1 },
    ])
  })

  it("任一行版本冲突 → 整批回滚（先改成功的行也不残留、无审计）", async () => {
    const x = (await createBulletin("p6cB_回滚X")).json.data!
    const y = (await createBulletin("p6cB_回滚Y")).json.data!
    const auditBefore = await countAudit(env.pool, "bulletin.reorder")
    const { res, json } = await reorder([
      { id: x.id, sortOrder: 555, version: x.version }, // 合法
      { id: y.id, sortOrder: 556, version: 999 }, // 旧版本 → 409
    ])
    expect(res.status).toBe(409)
    expect(json.error!.code).toBe("VERSION_CONFLICT")
    expect(String((await dbRow(x.id)).sort_order)).toBe(String(x.sortOrder)) // 第一行已回滚
    expect(String((await dbRow(x.id)).version)).toBe(String(x.version))
    expect(await countAudit(env.pool, "bulletin.reorder")).toBe(auditBefore)
  })

  it("幽灵 ID / 软删行 → 404 BULLETIN_NOT_FOUND 且整批回滚", async () => {
    const x = (await createBulletin("p6cB_回滚Z")).json.data!
    const deleted = await seedBulletinRaw(env.db, { title: "p6cB_已删排序", deleted: true })
    const auditBefore = await countAudit(env.pool, "bulletin.reorder")
    const ghost = await reorder([
      { id: x.id, sortOrder: 557, version: x.version },
      { id: "999999999994", sortOrder: 1, version: 1 },
    ])
    expect(ghost.res.status).toBe(404)
    expect(ghost.json.error!.code).toBe("BULLETIN_NOT_FOUND")
    const del = await reorder([
      { id: x.id, sortOrder: 558, version: x.version },
      { id: deleted, sortOrder: 1, version: 1 },
    ])
    expect(del.res.status).toBe(404)
    expect(String((await dbRow(x.id)).sort_order)).toBe(String(x.sortOrder))
    expect(await countAudit(env.pool, "bulletin.reorder")).toBe(auditBefore)
  })

  it("Zod 合同：ID 重复 422「排序条目 ID 重复」；空数组 422；GET → 405", async () => {
    const x = (await createBulletin("p6cB_去重")).json.data!
    const dup = await reorder([
      { id: x.id, sortOrder: 1, version: x.version },
      { id: x.id, sortOrder: 2, version: x.version },
    ])
    expect(dup.res.status).toBe(422)
    const e = dup.json.error!
    expect(`${e.message} ${Object.values(e.fields ?? {}).join(" ")}`).toContain("排序条目 ID 重复")
    expect((await reorder([])).res.status).toBe(422)
    expect((await reorderRoute.GET(reqFor(su, "GET", `${BASE}/reorder`))).status).toBe(405)
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：软删除与恢复（DELETE / POST restore）", () => {
  it("软删除：deletedAt 写入、状态保留；再删/编辑/改状态均 404", async () => {
    const { json } = await createBulletin("p6cB_软删除", { extra: { contentHtml: "<p>正文</p>" } })
    let d = json.data!
    d = (await body<BulletinDto>(await deleteBulletin(d.id, d.version))).data!
    expect(d.deletedAt).toBeTruthy()
    expect(d.status).toBe("draft")
    expect((await deleteBulletin(d.id, d.version)).status).toBe(404)
    expect((await patchBulletin(d.id, { title: "p6cB_删后改", version: d.version })).res.status).toBe(404)
    expect((await patchStatus(d.id, "published", d.version)).res.status).toBe(404)
  })

  it("软删除旧 version → 409；缺 version 参数 → 422", async () => {
    const { json } = await createBulletin("p6cB_删版本")
    const id = json.data!.id
    expect((await deleteBulletin(id, 99)).status).toBe(409)
    expect((await itemRoute.DELETE(reqFor(su, "DELETE", `${BASE}/${id}`), ctxOf(id))).status).toBe(422)
  })

  it("恢复保留原状态；已发布公告可直接恢复（无外部依赖）且 publishedAt 保留", async () => {
    const id = await seedBulletinRaw(env.db, {
      title: "p6cB_已发布被删",
      status: "published",
      contentHtml: "<p>正文</p>",
      publishedAt: "2026-01-02 03:04:05.000",
    })
    const del = (await body<BulletinDto>(await deleteBulletin(id, 1))).data!
    expect(del.status).toBe("published")
    const ok = await restoreBulletin(id, del.version)
    expect(ok.status).toBe(200)
    const r = (await body<BulletinDto>(ok)).data!
    expect(r.deletedAt).toBeNull()
    expect(r.status).toBe("published")
    expect(r.publishedAt).toBe("2026-01-02 03:04:05.000")
  })

  it("未删除行恢复 → 422「该公告未被删除，无需恢复」；version 不符 409；幽灵 404；GET 405", async () => {
    const { json } = await createBulletin("p6cB_未删恢复")
    const id = json.data!.id
    const again = await restoreBulletin(id, json.data!.version)
    expect(again.status).toBe(422)
    expect((await errBody(again)).error.message).toBe("该公告未被删除，无需恢复")

    const del = (await body<BulletinDto>(await deleteBulletin(id, json.data!.version))).data!
    expect((await restoreBulletin(id, 99)).status).toBe(409)
    expect((await restoreBulletin("999999999995", 1)).status).toBe(404)
    expect((await restoreBulletin(id, del.version)).status).toBe(200)
    expect((await restoreRoute.GET(reqFor(su, "GET", `${BASE}/${id}/restore`))).status).toBe(405)
  })

  it("bulletin.soft_delete / bulletin.restore 审计（deleted_at 前后语义）", async () => {
    const { json } = await createBulletin("p6cB_删除审计")
    const id = json.data!.id
    const d = (await body<BulletinDto>(await deleteBulletin(id, json.data!.version))).data!
    const restored = (await body<BulletinDto>(await restoreBulletin(id, d.version))).data!
    const delRow = (await auditRows(env.pool, "bulletin.soft_delete")).find((r) => r.resource_id === id)!
    const resRow = (await auditRows(env.pool, "bulletin.restore")).find((r) => r.resource_id === id)!
    expect(auditJson(delRow.before_json).deleted_at).toBeNull()
    expect(auditJson(delRow.after_json).deleted_at).toBeTruthy()
    expect(auditJson(resRow.before_json).deleted_at).toBeTruthy()
    expect(auditJson(resRow.after_json).deleted_at).toBeNull()
    expect(restored.deletedAt).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 公告：RBAC（4 角色 × 端点矩阵）", () => {
  it("auditor：读放行，全部写端点 403（含 reorder）且不产生审计", async () => {
    const target = (await createBulletin("p6cB_RBAC审计员")).json.data!
    const auditBefore = await countAllAudit()
    expect((await listRoute.GET(reqFor(auditor, "GET", BASE))).status).toBe(200)
    expect((await itemRoute.GET(reqFor(auditor, "GET", `${BASE}/${target.id}`), ctxOf(target.id))).status).toBe(200)
    const writes: Array<[string, Promise<Response>]> = [
      ["POST", listRoute.POST(reqFor(auditor, "POST", BASE, { title: "p6cB_a" }))],
      ["PATCH", itemRoute.PATCH(reqFor(auditor, "PATCH", `${BASE}/${target.id}`, { title: "y", version: target.version }), ctxOf(target.id))],
      ["STATUS", statusRoute.PATCH(reqFor(auditor, "PATCH", `${BASE}/${target.id}/status`, { status: "published", version: target.version }), ctxOf(target.id))],
      ["DELETE", itemRoute.DELETE(reqFor(auditor, "DELETE", `${BASE}/${target.id}?version=${target.version}`), ctxOf(target.id))],
      ["RESTORE", restoreRoute.POST(reqFor(auditor, "POST", `${BASE}/${target.id}/restore`, { version: target.version }), ctxOf(target.id))],
      ["REORDER", reorderRoute.POST(reqFor(auditor, "POST", `${BASE}/reorder`, { items: [{ id: target.id, sortOrder: 1, version: target.version }] }))],
    ]
    for (const [label, p] of writes) {
      const res = await p
      expect(res.status, label).toBe(403)
      expect((await errBody(res)).error.code, label).toBe("FORBIDDEN")
    }
    expect(await countAllAudit()).toBe(auditBefore)
  })

  it("content_editor：可增改/排序；发布、删除、恢复 403", async () => {
    const made = await createBulletin("p6cB_编辑者新建", { session: editor, extra: { contentHtml: "<p>正文</p>" } })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    expect((await patchBulletin(id, { title: "p6cB_编辑者改名", version: made.json.data!.version }, editor)).res.status).toBe(200)
    const afterPatch = await getBulletin(id)
    expect((await reorder([{ id, sortOrder: 0, version: afterPatch.data!.version }], editor)).res.status).toBe(200)
    const afterReorder = await getBulletin(id)
    expect((await patchStatus(id, "published", afterReorder.data!.version, editor)).res.status).toBe(403)
    expect((await deleteBulletin(id, afterReorder.data!.version, editor)).status).toBe(403)
    expect((await restoreBulletin(id, afterReorder.data!.version, editor)).status).toBe(403)
    // super 收尾
    expect((await patchStatus(id, "published", afterReorder.data!.version)).res.status).toBe(200)
  })

  it("content_admin：内容全权（发布 + 删除 + 恢复放行）", async () => {
    const made = await createBulletin("p6cB_内容管理员", { session: cadmin, extra: { contentHtml: "<p>正文</p>" } })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    expect((await patchStatus(id, "published", made.json.data!.version, cadmin)).res.status).toBe(200)
    const pub = (await getBulletin(id, cadmin)).data!
    expect((await deleteBulletin(id, pub.version, cadmin)).status).toBe(200)
    expect((await restoreBulletin(id, pub.version + 1, cadmin)).status).toBe(200)
  })

  it("无会话访问读写端点均 401", async () => {
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noAuth: true }))).status).toBe(401)
    expect((await itemRoute.PATCH(reqFor(su, "PATCH", `${BASE}/1`, { title: "x", version: 1 }, { noAuth: true }), ctxOf("1"))).status).toBe(401)
  })
})
