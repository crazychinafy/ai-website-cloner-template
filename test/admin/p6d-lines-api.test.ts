// P6D §6/§10/§十二 线路管理 API 全链路（scratch 库 facai8_p6d_test，真实 route handler 调用）
// - 新建恒 disabled / version=1 / AUTO_INCREMENT 十进制字符串 ID / sortOrder 追加末尾
// - strictObject 拒绝 id/status/deletedAt；PATCH 无 status（启停走 /status）
// - url 仅格式校验（httpUrlSchema）；服务端绝不探测 URL（fetch spy = 0）
// - 状态机 active↔disabled；同态 422 LINE_STATUS_TRANSITION；乐观锁 409 固定文案；软删除行 404
// - reorder：全局作用域（resource_id=global）、去重、逐行版本、任一失败整批回滚、审计 before/after
// - 软删除/恢复保留原 name/url/status/排序；RBAC 四角色 + CSRF；403/409/422 零成功审计
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { LineDto } from "../../src/lib/admin/dto/line.ts"
import type { PageResult } from "../../src/lib/admin/dto/content.ts"
import {
  auditJson,
  auditRows,
  countAudit,
  errBody,
  p6dLogin,
  rawQuery,
  reqFor,
  seedLineRaw,
  setupP6dEnv,
  teardownP6dEnv,
  type P6dEnv,
  type P6dSession,
} from "./p6d-harness"

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

const BASE = "/api/admin/v1/lines"

async function createLine(
  name: string,
  opts: { session?: P6dSession; url?: string; extra?: Record<string, unknown> } = {},
): Promise<{ res: Response; json: Envelope<LineDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", BASE, { name, url: opts.url ?? "https://example.com/line", ...(opts.extra ?? {}) }),
  )
  return { res, json: await body<LineDto>(res) }
}

let seq = 0
async function createFull(extra: Record<string, unknown> = {}): Promise<LineDto> {
  const { json } = await createLine(`p6d-line-${Date.now()}-${seq++}`, { extra })
  if (!json.data) throw new Error(`create failed: ${JSON.stringify(json.error)}`)
  return json.data
}

async function getLine(id: string, session: P6dSession = su): Promise<Envelope<LineDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `${BASE}/${id}`), ctxOf(id)))
}

async function patchLine(id: string, payload: Record<string, unknown>, session: P6dSession = su) {
  const res = await itemRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}`, payload), ctxOf(id))
  return { res, json: await body<LineDto>(res) }
}

async function changeStatus(id: string, status: string, version: number, session: P6dSession = su) {
  const res = await statusRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}/status`, { status, version }), ctxOf(id))
  return { res, json: await body<LineDto>(res) }
}

async function deleteLine(id: string, version: number, session: P6dSession = su) {
  const res = await itemRoute.DELETE(reqFor(session, "DELETE", `${BASE}/${id}?version=${version}`), ctxOf(id))
  return { res, json: await body<LineDto>(res) }
}

async function restoreLine(id: string, version: number, session: P6dSession = su) {
  const res = await restoreRoute.POST(reqFor(session, "POST", `${BASE}/${id}/restore`, { version }), ctxOf(id))
  return { res, json: await body<LineDto>(res) }
}

async function reorder(items: unknown[], session: P6dSession = su) {
  const res = await reorderRoute.POST(reqFor(session, "POST", `${BASE}/reorder`, { items }))
  return { res, json: await body<{ records: LineDto[] }>(res) }
}

async function rawLine(id: string): Promise<Record<string, unknown>> {
  const rows = await rawQuery(env.pool, "SELECT * FROM site_lines WHERE id = ?", [id])
  return rows[0]!
}

/** SSRF 禁令（§6.7）：线路保存/启停全程不得发起服务端 fetch（可达性属前台探测） */
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
  su = await p6dLogin(env, "p6d-su-lines", ["super_admin"])
  auditor = await p6dLogin(env, "p6d-auditor-lines", ["auditor"])
  editor = await p6dLogin(env, "p6d-editor-lines", ["content_editor"])
  cadmin = await p6dLogin(env, "p6d-cadmin-lines", ["content_admin"])

  listRoute = await import("../../src/app/api/admin/v1/lines/route")
  itemRoute = await import("../../src/app/api/admin/v1/lines/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/lines/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/lines/[id]/restore/route")
  reorderRoute = await import("../../src/app/api/admin/v1/lines/reorder/route")
})

afterAll(async () => {
  if (env) await teardownP6dEnv(env)
})

describe("新建（恒 disabled / version=1 / 默认值）", () => {
  it("POST 新建：恒 disabled、version=1、十进制字符串自增 ID、未删除", async () => {
    const { res, json } = await createLine("自增测试线路")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(d.status).toBe("disabled") // §6.2：新建默认停用，必须管理员确认后启用
    expect(d.version).toBe(1)
    expect(d.deletedAt).toBeNull()
  })

  it("新建 ID 严格递增；sortOrder 省略 = 追加有效行末尾，显式值尊重传入", async () => {
    const a = await createFull()
    const b = await createFull()
    expect(BigInt(b.id)).toBeGreaterThan(BigInt(a.id))
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)
    const c = await createFull({ sortOrder: 4242 })
    expect(c.sortOrder).toBe(4242)
  })

  it("保存全程不发起服务端 fetch（§6.7：URL 可达性由前台浏览器侧探测）", async () => {
    const { fetchCalls } = await withFetchSpy(async () => {
      const line = await createLine(`探测测试${seq++}`, { url: "https://traced.example.com/a?token=abc" })
      const d = line.json.data!
      await patchLine(d.id, { version: d.version, url: "https://traced.example.com/b" })
      await changeStatus(d.id, "active", d.version + 1)
    })
    expect(fetchCalls).toBe(0)
  })
})

describe("创建校验（422 / strictObject 保护字段）", () => {
  it("名称必填；超长（>255）→ 422", async () => {
    const empty = await createLine("   ")
    expect(empty.res.status).toBe(422)
    const long = await createLine("长".repeat(256))
    expect(long.res.status).toBe(422)
  })

  it("url：危险协议 / 非 URL / userinfo / 相对路径一律 422", async () => {
    for (const url of ["javascript:alert(1)", "not a url", "https://u:p@example.com/", "/relative/path", "data:text/html;base64,x"]) {
      const { res } = await createLine("URL测试", { url })
      expect(res.status, url).toBe(422)
    }
  })

  it("客户端不许传 id / status / version / deletedAt（strictObject）", async () => {
    for (const extra of [{ id: "123" }, { status: "active" }, { version: 1 }, { deletedAt: null }]) {
      const { res } = await createLine("保护字段", { extra })
      expect(res.status, JSON.stringify(extra)).toBe(422)
    }
  })

  it("sortOrder 非负整数", async () => {
    expect((await createLine("负排序", { extra: { sortOrder: -1 } })).res.status).toBe(422)
  })
})

describe("PATCH 编辑（无 status / 乐观锁 / 审计差量）", () => {
  it("编辑名称与 URL → 200，version+1，审计记录真实差量", async () => {
    const line = await createFull()
    const { res, json } = await patchLine(line.id, { version: line.version, name: "改名线路", url: "https://new.example.com/x" })
    expect(res.status).toBe(200)
    expect(json.data!.name).toBe("改名线路")
    expect(json.data!.url).toBe("https://new.example.com/x")
    expect(json.data!.version).toBe(line.version + 1)
    const rows = await auditRows(env.pool, "line.update")
    const last = rows[rows.length - 1]!
    expect(auditJson(last.before_json).name).toBe(line.name)
    expect(auditJson(last.after_json).name).toBe("改名线路")
  })

  it("PATCH 不接受 status（启停走 /status 独立接口，§6.3/§6.4）", async () => {
    const line = await createFull()
    const { res } = await patchLine(line.id, { version: line.version, status: "active" })
    expect(res.status).toBe(422)
  })

  it("PATCH 必须带 version；缺省 422；空对象 422", async () => {
    const line = await createFull()
    expect((await patchLine(line.id, { name: "无版本" })).res.status).toBe(422)
    expect((await patchLine(line.id, { version: line.version })).res.status).toBe(422)
  })

  it("version 冲突 → 409 固定文案，值不变，零成功审计", async () => {
    const line = await createFull()
    const before = await countAudit(env.pool, "line.update")
    const { res, json } = await patchLine(line.id, { version: line.version + 5, name: "冲突编辑" })
    expect(res.status).toBe(409)
    expect(json.error!.code).toBe("VERSION_CONFLICT")
    expect(json.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect((await getLine(line.id)).data!.name).not.toBe("冲突编辑")
    expect(await countAudit(env.pool, "line.update")).toBe(before)
  })

  it("软删除行 PATCH → 404", async () => {
    const id = await seedLineRaw(env.db, { deleted: true })
    const v = Number((await rawLine(id)).version)
    expect((await patchLine(id, { version: v, name: "改已删" })).res.status).toBe(404)
  })

  it("targetUrl 审计快照 token 参数脱敏（§十二-2）", async () => {
    const line = await createFull()
    await patchLine(line.id, { version: line.version, url: "https://e.com/l?token=S3CR3TVAL&x=1" })
    const rows = await auditRows(env.pool, "line.update")
    const last = rows[rows.length - 1]!
    const after = auditJson(last.after_json)
    expect(after.url).toContain("token=***")
    expect(after.url).not.toContain("S3CR3TVAL")
    expect(after.url).toContain("x=1")
  })
})

describe("启停（PATCH /status；line.enable / line.disable）", () => {
  it("新建 disabled → enable 200 active → disable 200 disabled，version 递增", async () => {
    const line = await createFull()
    const on = await changeStatus(line.id, "active", line.version)
    expect(on.res.status).toBe(200)
    expect(on.json.data!.status).toBe("active")
    expect(on.json.data!.version).toBe(line.version + 1)
    const off = await changeStatus(line.id, "disabled", on.json.data!.version)
    expect(off.res.status).toBe(200)
    expect(off.json.data!.status).toBe("disabled")
  })

  it("同态切换 → 422 LINE_STATUS_TRANSITION（用最新 version）", async () => {
    const line = await createFull()
    await changeStatus(line.id, "active", line.version)
    const fresh = await getLine(line.id)
    const same = await changeStatus(line.id, "active", fresh.data!.version)
    expect(same.res.status).toBe(422)
    expect(same.json.error!.code).toBe("LINE_STATUS_TRANSITION")
  })

  it("status 只有 active|disabled：draft/published 等目标 422（schema）", async () => {
    const line = await createFull()
    for (const s of ["draft", "published", "expired"]) {
      expect((await changeStatus(line.id, s, line.version)).res.status).toBe(422)
    }
  })

  it("version 冲突 → 409 固定文案，status 不变", async () => {
    const line = await createFull()
    const { res, json } = await changeStatus(line.id, "active", line.version + 9)
    expect(res.status).toBe(409)
    expect(json.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect((await getLine(line.id)).data!.status).toBe("disabled")
  })

  it("软删除行启停 → 404", async () => {
    const id = await seedLineRaw(env.db, { status: "active", deleted: true })
    const v = Number((await rawLine(id)).version)
    expect((await changeStatus(id, "disabled", v)).res.status).toBe(404)
  })

  it("enable/disable 分别审计且记录 status 差量", async () => {
    const line = await createFull()
    await changeStatus(line.id, "active", line.version)
    const enableRows = await auditRows(env.pool, "line.enable")
    expect(auditJson(enableRows[enableRows.length - 1]!.after_json).status).toBe("active")
    expect(auditJson(enableRows[enableRows.length - 1]!.before_json).status).toBe("disabled")
    const enabled = await getLine(line.id)
    await changeStatus(line.id, "disabled", enabled.data!.version)
    const disableRows = await auditRows(env.pool, "line.disable")
    expect(auditJson(disableRows[disableRows.length - 1]!.after_json).status).toBe("disabled")
  })
})

describe("批量排序（POST /lines/reorder；全局作用域）", () => {
  it("三条重排成功 → sortOrder 生效、逐行 version+1、审计 resource_id=global 与前后 items", async () => {
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
    const rows = await auditRows(env.pool, "line.reorder")
    const last = rows[rows.length - 1]!
    expect(last.resource_id).toBe("global") // §6.5：线路无 position，全局一个排序范围
    const after = auditJson(last.after_json).items as { id: string; sort_order: number }[]
    expect(after.find((i) => i.id === c.id)!.sort_order).toBe(10)
  })

  it("reorder 不接受 position 字段（全局合同，strictObject）", async () => {
    const a = await createFull()
    const res = await reorderRoute.POST(
      reqFor(su, "POST", `${BASE}/reorder`, { items: [{ id: a.id, sortOrder: 1, version: a.version }], position: "home" }),
    )
    expect(res.status).toBe(422)
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

  it("任一行版本冲突 → 整批回滚（先处理的行也不落库）", async () => {
    const a = await createFull()
    const b = await createFull()
    const { res } = await reorder([
      { id: a.id, sortOrder: 999, version: a.version },
      { id: b.id, sortOrder: 998, version: b.version + 7 },
    ])
    expect(res.status).toBe(409)
    expect((await getLine(a.id)).data!.sortOrder).not.toBe(999)
    expect((await getLine(a.id)).data!.version).toBe(a.version)
  })

  it("包含软删除行 → 404 且整批回滚", async () => {
    const a = await createFull()
    const gone = await seedLineRaw(env.db, { deleted: true })
    const gv = Number((await rawLine(gone)).version)
    const { res } = await reorder([
      { id: a.id, sortOrder: 777, version: a.version },
      { id: gone, sortOrder: 776, version: gv },
    ])
    expect(res.status).toBe(404)
    expect((await getLine(a.id)).data!.sortOrder).not.toBe(777)
  })
})

describe("软删除与恢复", () => {
  it("DELETE ?version= → 软删除，列表默认隐藏、includeDeleted 可见，审计 line.soft_delete", async () => {
    const line = await createFull()
    const { res, json } = await deleteLine(line.id, line.version)
    expect(res.status).toBe(200)
    expect(json.data!.deletedAt).toBeTruthy()
    const list = await body<PageResult<LineDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=${encodeURIComponent(line.name)}`)))
    expect(list.data!.items.some((i) => i.id === line.id)).toBe(false)
    const listAll = await body<PageResult<LineDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=${encodeURIComponent(line.name)}&includeDeleted=true`)),
    )
    expect(listAll.data!.items.some((i) => i.id === line.id)).toBe(true)
    const rows = await auditRows(env.pool, "line.soft_delete")
    expect(auditJson(rows[rows.length - 1]!.before_json).deleted_at).toBeNull()
  })

  it("重复 DELETE / 缺 version 参数 / 错 version → 404、422、409", async () => {
    const line = await createFull()
    await deleteLine(line.id, line.version)
    expect((await deleteLine(line.id, line.version)).res.status).toBe(404)
    const bare = await itemRoute.DELETE(reqFor(su, "DELETE", `${BASE}/${line.id}`), ctxOf(line.id))
    expect(bare.status).toBe(422)
    const other = await createFull()
    expect((await deleteLine(other.id, other.version + 3)).res.status).toBe(409)
  })

  it("恢复：保留原 status/sortOrder/url，清 deletedAt，审计 line.restore", async () => {
    const id = await seedLineRaw(env.db, { status: "active", sortOrder: 55, url: "https://keep.example.com/x", deleted: true })
    const v = Number((await rawLine(id)).version)
    const { res, json } = await restoreLine(id, v)
    expect(res.status).toBe(200)
    expect(json.data!.deletedAt).toBeNull()
    expect(json.data!.status).toBe("active") // §6.6：恢复不改状态
    expect(json.data!.sortOrder).toBe(55)
    expect(json.data!.url).toBe("https://keep.example.com/x")
    const rows = await auditRows(env.pool, "line.restore")
    expect(auditJson(rows[rows.length - 1]!.before_json).deleted_at).toBeTruthy()
  })

  it("未删除行 restore → 422；错 version → 409", async () => {
    const line = await createFull()
    expect((await restoreLine(line.id, line.version)).res.status).toBe(422)
    const id = await seedLineRaw(env.db, { deleted: true })
    expect((await restoreLine(id, 999)).res.status).toBe(409)
  })
})

describe("列表查询与路由杂项", () => {
  it("status 过滤只有 active|disabled（published 422）；pageSize 只允许 20/50/100", async () => {
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?status=active`))).status).toBe(200)
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?status=disabled`))).status).toBe(200)
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?status=published`))).status).toBe(422)
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?pageSize=7`))).status).toBe(422)
    expect((await listRoute.GET(reqFor(su, "GET", `${BASE}?sortBy=bogus`))).status).toBe(422)
  })

  it("非法 ID 段 → 422；未知 ID → 404；PUT 段 405", async () => {
    expect((await itemRoute.GET(reqFor(su, "GET", `${BASE}/abc`), ctxOf("abc"))).status).toBe(422)
    expect((await itemRoute.GET(reqFor(su, "GET", `${BASE}/999999999999999999`), ctxOf("999999999999999999"))).status).toBe(404)
    expect((await listRoute.PUT()).status).toBe(405)
  })
})

describe("认证 / CSRF / RBAC（API 强制，§九）", () => {
  it("未登录：GET 401、POST 401", async () => {
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noAuth: true }))).status).toBe(401)
    expect((await listRoute.POST(reqFor(su, "POST", BASE, { name: "x" }, { noAuth: true }))).status).toBe(401)
  })

  it("缺 CSRF：写操作 403 CSRF_INVALID，GET 不受影响", async () => {
    const res = await listRoute.POST(reqFor(su, "POST", BASE, { name: "无csrf", url: "https://e.com/x" }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("CSRF_INVALID")
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noCsrf: true }))).status).toBe(200)
  })

  it("auditor 只读：GET 200，全部写路径 403 且零成功审计", async () => {
    expect((await listRoute.GET(reqFor(auditor, "GET", BASE))).status).toBe(200)
    const line = await createFull()
    const before = await countAudit(env.pool, "line.create")
    expect((await createLine("审计写", { session: auditor })).res.status).toBe(403)
    expect((await patchLine(line.id, { version: line.version, name: "审计改" }, auditor)).res.status).toBe(403)
    expect((await changeStatus(line.id, "active", line.version, auditor)).res.status).toBe(403)
    expect((await deleteLine(line.id, line.version, auditor)).res.status).toBe(403)
    expect((await restoreLine(line.id, line.version, auditor)).res.status).toBe(403)
    expect((await reorder([{ id: line.id, sortOrder: 1, version: line.version }], auditor)).res.status).toBe(403)
    expect(await countAudit(env.pool, "line.create")).toBe(before)
  })

  it("content_editor 无 lines.delete：建/改/启停/排序 200，删除与恢复 403", async () => {
    const { res, json } = await createLine("编辑者建", { session: editor })
    expect(res.status).toBe(200)
    const line = json.data!
    expect((await patchLine(line.id, { version: line.version, name: "编辑者改" }, editor)).res.status).toBe(200)
    const updated = await getLine(line.id)
    expect((await changeStatus(line.id, "active", updated.data!.version, editor)).res.status).toBe(200)
    const enabled = await getLine(line.id)
    expect((await reorder([{ id: line.id, sortOrder: 3, version: enabled.data!.version }], editor)).res.status).toBe(200)
    const fresh = await getLine(line.id)
    expect((await deleteLine(line.id, fresh.data!.version, editor)).res.status).toBe(403)
    expect((await restoreLine(line.id, fresh.data!.version, editor)).res.status).toBe(403)
  })

  it("content_admin 拥有 lines.delete：删除+恢复闭环 200", async () => {
    const { json } = await createLine("cadmin删除", { session: cadmin })
    const line = json.data!
    expect((await deleteLine(line.id, line.version, cadmin)).res.status).toBe(200)
    const deleted = await getLine(line.id)
    expect((await restoreLine(line.id, deleted.data!.version, cadmin)).res.status).toBe(200)
  })
})
