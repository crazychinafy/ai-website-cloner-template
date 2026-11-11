// P6A §14.2 标签 API 全链路：CRUD / 颜色与图标预览字段 / 全局排序 / 状态 / 软删除保护（含软删除网址）/
// 恢复 / 乐观锁 / RBAC / CSRF / 审计（scratch 库，真实 route handler 调用）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PageResult, TagDto } from "../../src/lib/admin/dto/content.ts"
import {
  auditJson,
  auditRows,
  p6aLogin,
  rawQuery,
  reqFor,
  seedLink,
  setupP6aEnv,
  teardownP6aEnv,
  type P6aEnv,
  type P6aSession,
} from "./p6a-harness"

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

let env: P6aEnv
let su: P6aSession
let auditor: P6aSession
let editor: P6aSession
let cadmin: P6aSession

let listRoute: { GET: R1; POST: R1 }
let reorderRoute: { PATCH: R1 }
let itemRoute: { GET: R2; PATCH: R2; DELETE: R2 }
let statusRoute: { GET: R1; PATCH: R2 }
let restoreRoute: { POST: R2 }

const T: Record<string, TagDto> = {}

async function createTag(
  name: string,
  opts: { session?: P6aSession; extra?: Record<string, unknown>; key?: string } = {},
): Promise<{ res: Response; json: Envelope<TagDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", "/api/admin/v1/tags", {
      name,
      ...(opts.extra ?? {}),
    }),
  )
  const json = await body<TagDto>(res)
  if (res.status === 200 && json.data) T[opts.key ?? name] = json.data
  return { res, json }
}

async function getTag(id: string, session: P6aSession = su): Promise<Envelope<TagDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `/api/admin/v1/tags/${id}`), ctxOf(id)))
}

async function getTagWithDeleted(id: string): Promise<TagDto> {
  const res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags?includeDeleted=true&sortBy=id&sortDir=desc"))
  return (await body<PageResult<TagDto>>(res)).data!.items.find((i) => i.id === id)!
}

beforeAll(async () => {
  env = await setupP6aEnv()
  listRoute = await import("../../src/app/api/admin/v1/tags/route")
  reorderRoute = await import("../../src/app/api/admin/v1/tags/reorder/route")
  itemRoute = await import("../../src/app/api/admin/v1/tags/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/tags/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/tags/[id]/restore/route")
  su = await p6aLogin(env, "p6a_tag_super", ["super_admin"])
  auditor = await p6aLogin(env, "p6a_tag_auditor", ["auditor"])
  editor = await p6aLogin(env, "p6a_tag_editor", ["content_editor"])
  cadmin = await p6aLogin(env, "p6a_tag_cadmin", ["content_admin"])
}, 240_000)

afterAll(async () => {
  await teardownP6aEnv(env)
})

describe("P6A 标签：创建与颜色合同", () => {
  it("创建 → 200，DTO 合同（字符串 id / version=1 / linkCount=0 / 无 updatedAt——site_tags 无该列）", async () => {
    const { res, json } = await createTag("p6a_标签_正规")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(typeof d.id).toBe("string")
    expect(d.version).toBe(1)
    expect(d.linkCount).toBe(0)
    expect(d.status).toBe("active")
    expect(d.deletedAt).toBeNull()
    expect(typeof d.createdAt).toBe("string")
    expect("updatedAt" in d).toBe(false)
  })

  it("缺省颜色：color=#000000 / bgColor=#ffffff；显式 HEX 统一小写入库", async () => {
    const d = (await getTag(T["p6a_标签_正规"].id)).data!
    expect(d.color).toBe("#000000")
    expect(d.bgColor).toBe("#ffffff")

    const made = await createTag("p6a_标签_大写色", { extra: { color: " #FF8800 ", bgColor: "#0000FF" } })
    expect(made.res.status).toBe(200)
    expect(made.json.data!.color).toBe("#ff8800")
    expect(made.json.data!.bgColor).toBe("#0000ff")
    const db = await rawQuery<{ color: string; bg_color: string }>(
      env.pool,
      "SELECT color, bg_color FROM site_tags WHERE id = ?",
      [made.json.data!.id],
    )
    expect(db[0]!.color).toBe("#ff8800")
    expect(db[0]!.bg_color).toBe("#0000ff")
  })

  it("sortOrder 全局自增；显式值/状态生效；iconClass 多 class 原样保存", async () => {
    const second = await createTag("p6a_标签_新盘")
    expect(second.json.data!.sortOrder).toBe(3) // 前面已建 2 个（正规、大写色）
    const icon = await createTag("p6a_标签_带图标", { extra: { iconClass: "il7e7595cf1d30 iconfont icon-USDT" } })
    expect(icon.json.data!.iconClass).toBe("il7e7595cf1d30 iconfont icon-USDT")
    const explicit = await createTag("p6a_标签_显式", { extra: { sortOrder: 66, status: "disabled" } })
    expect(explicit.json.data!.sortOrder).toBe(66)
    expect(explicit.json.data!.status).toBe("disabled")
  })

  it("校验：重名 → 422 fields.name；非法颜色/图标/排序 → 422", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_正规" }))
    expect(res.status).toBe(422)
    let j = await body<never>(res)
    expect(j.error?.code).toBe("VALIDATION_ERROR")
    expect(j.error?.fields?.name).toBeTruthy()

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_坏色", color: "teal" }))
    expect(res.status).toBe(422)
    j = await body<never>(res)
    expect(j.error?.fields?.color).toBeTruthy()

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_坏bg", bgColor: "#FFF" }))
    expect(res.status).toBe(422)
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "" }))
    expect(res.status).toBe(422)
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_坏图标", iconClass: 'x" onclick=y' }))
    expect(res.status).toBe(422)
  })
})

describe("P6A 标签：读取", () => {
  it("GET list：分页 meta / 默认 sortOrder asc / q / status / linkCount 计数", async () => {
    const all = await body<PageResult<TagDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags?pageSize=20")))
    expect(all.data!.page).toBe(1)
    expect(all.data!.pageSize).toBe(20)
    expect(all.data!.items.map((i) => i.sortOrder)).toEqual([...all.data!.items.map((i) => i.sortOrder)].sort((a, b) => a - b))

    const q = await body<PageResult<TagDto>>(
      await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/tags?q=${encodeURIComponent("正规")}`)),
    )
    expect(q.data!.items.map((i) => i.id)).toEqual([T["p6a_标签_正规"].id])

    const disabled = await body<PageResult<TagDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags?status=disabled")))
    expect(disabled.data!.items.every((i) => i.status === "disabled")).toBe(true)
  })

  it("GET list 非法参数 → 422", async () => {
    for (const qs of ["pageSize=30", "sortBy=color", "sortDir=up", "page=0"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/tags?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })

  it("GET 单条：非法 id → 422；不存在 → 404 TAG_NOT_FOUND；未认证 list → 401", async () => {
    let res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags/abc"), ctxOf("abc"))
    expect(res.status).toBe(422)
    res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags/9000000000000000222"), ctxOf("9000000000000000222"))
    expect(res.status).toBe(404)
    expect((await body<never>(res)).error?.code).toBe("TAG_NOT_FOUND")
    res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags", undefined, { noAuth: true }))
    expect(res.status).toBe(401)
  })
})

describe("P6A 标签：更新 / 乐观锁", () => {
  it("PATCH 改名/颜色/图标 → 200 version+1，审计 before/after 含 color 差异", async () => {
    const cur = (await getTag(T["p6a_标签_新盘"].id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}`, {
        name: "p6a_标签_新盘改名",
        color: "#11AA22",
        iconClass: "iconfont icon-new",
        version: cur.version,
      }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    const d = (await body<TagDto>(res)).data!
    expect(d.name).toBe("p6a_标签_新盘改名")
    expect(d.color).toBe("#11aa22")
    expect(d.version).toBe(cur.version + 1)

    const rows = await auditRows(env.pool, "tag.update")
    const row = rows.find((r) => auditJson(r.after_json)?.color === "#11aa22")!
    expect(auditJson(row.before_json).color).toBe("#000000")
    expect(auditJson(row.after_json).icon_class).toBe("iconfont icon-new")
  })

  it("PATCH 旧 version → 409 VERSION_CONFLICT 固定文案；空改动 → 422；重名 → 422", async () => {
    const cur = (await getTag(T["p6a_标签_新盘"].id)).data!
    let res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}`, { name: "p6a_不该成功", version: cur.version - 1 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VERSION_CONFLICT")
    expect(j.error?.message).toBe(VERSION_CONFLICT_MSG)

    res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}`, { version: cur.version }), ctxOf(cur.id))
    expect(res.status).toBe(422)

    res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}`, { name: "p6a_标签_正规", version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.fields?.name).toBeTruthy()
  })

  it("PATCH 已删除标签 → 404", async () => {
    const made = await createTag("p6a_标签_删后改")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/tags/${id}`, { name: "p6a_改名失败", version: 2 }), ctxOf(id))
    expect(res.status).toBe(404)
  })
})

describe("P6A 标签：状态切换", () => {
  it("disable/enable → 200，审计 tag.disable / tag.enable", async () => {
    const cur = (await getTag(T["p6a_标签_正规"].id)).data!
    let res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}/status`, { status: "disabled", version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    expect((await body<TagDto>(res)).data!.status).toBe("disabled")
    let rows = await auditRows(env.pool, "tag.disable")
    expect(rows.some((r) => r.resource_id === cur.id && r.resource_type === "tag")).toBe(true)

    const cur2 = (await getTag(cur.id)).data!
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}/status`, { status: "active", version: cur2.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    rows = await auditRows(env.pool, "tag.enable")
    expect(rows.some((r) => r.resource_id === cur.id)).toBe(true)
  })

  it("status：旧 version → 409；非法 body → 422；GET → 405；不存在 → 404", async () => {
    const cur = (await getTag(T["p6a_标签_正规"].id)).data!
    let res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}/status`, { status: "disabled", version: 999999 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/tags/${cur.id}/status`, { status: "on", version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(422)
    expect((await statusRoute.GET(reqFor(su, "GET", `/api/admin/v1/tags/${cur.id}/status`))).status).toBe(405)
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/tags/9000000000000000333/status", { status: "disabled", version: 1 }),
      ctxOf("9000000000000000333"),
    )
    expect(res.status).toBe(404)
  })
})

describe("P6A 标签：全局批量排序", () => {
  it("交换 sortOrder → 200，version 各自 +1，审计 resourceId=global", async () => {
    const a = (await getTag(T["p6a_标签_正规"].id)).data!
    const b = (await getTag(T["p6a_标签_新盘"].id)).data!
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/tags/reorder", {
        items: [
          { id: a.id, sortOrder: 800, version: a.version },
          { id: b.id, sortOrder: 801, version: b.version },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const j = await body<{ records: TagDto[] }>(res)
    expect(j.data!.records.find((r) => r.id === a.id)!.sortOrder).toBe(800)
    expect(j.data!.records.find((r) => r.id === b.id)!.version).toBe(b.version + 1)
    const rows = await auditRows(env.pool, "tag.reorder")
    expect(rows.some((r) => r.resource_id === "global")).toBe(true)
  })

  it("任一条 version 冲突 → 409 整批回滚、无审计", async () => {
    const a = (await getTag(T["p6a_标签_正规"].id)).data!
    const b = (await getTag(T["p6a_标签_新盘"].id)).data!
    const beforeAudit = (await auditRows(env.pool, "tag.reorder")).length
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/tags/reorder", {
        items: [
          { id: a.id, sortOrder: 1, version: a.version },
          { id: b.id, sortOrder: 2, version: b.version + 5 },
        ],
      }),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
    expect((await getTag(T["p6a_标签_正规"].id)).data!.sortOrder).toBe(a.sortOrder)
    expect((await auditRows(env.pool, "tag.reorder")).length).toBe(beforeAudit)
  })

  it("items 空 / id 重复 → 422；条目不存在 → 404", async () => {
    let res = await reorderRoute.PATCH(reqFor(su, "PATCH", "/api/admin/v1/tags/reorder", { items: [] }))
    expect(res.status).toBe(422)
    res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/tags/reorder", {
        items: [
          { id: "10", sortOrder: 0, version: 1 },
          { id: "10", sortOrder: 1, version: 1 },
        ],
      }),
    )
    expect(res.status).toBe(422)
    res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/tags/reorder", { items: [{ id: "9000000000000000999", sortOrder: 0, version: 1 }] }),
    )
    expect(res.status).toBe(404)
  })
})

describe("P6A 标签：软删除保护与恢复", () => {
  // seedLink 挂 link_categories 真实分类（FK）：用固定雪花 ID 直插一条宿主分类
  let hostCatId = ""
  beforeAll(async () => {
    hostCatId = "8900000000000000001"
    await env.pool.query(
      "INSERT INTO link_categories (id, name, sort_order) VALUES (?, 'p6a-tag-host-category', 1)",
      [hostCatId],
    )
  })

  it("有网址（1 正常 + 1 软删除）→ 409 TAG_HAS_LINKS，消息含计数；linkCount=2", async () => {
    const made = await createTag("p6a_标签_被引用")
    const id = made.json.data!.id
    await seedLink(env.db, { categoryId: hostCatId, tagId: id, title: "p6a-tag-link-1" })
    await seedLink(env.db, { categoryId: hostCatId, tagId: id, title: "p6a-tag-link-del", deleted: true })
    const cur = (await getTag(id)).data!
    expect(cur.linkCount).toBe(2)
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=${cur.version}`), ctxOf(id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("TAG_HAS_LINKS")
    expect(j.error?.message).toContain("2")
  })

  it("只有软删除网址也阻止删除", async () => {
    const made = await createTag("p6a_标签_仅软删引用")
    const id = made.json.data!.id
    await seedLink(env.db, { categoryId: hostCatId, tagId: id, title: "p6a-tag-del2", deleted: true })
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("TAG_HAS_LINKS")
  })

  it("DELETE 缺 version / 非法 version → 422；旧 version → 409", async () => {
    const made = await createTag("p6a_标签_干净删除")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}`), ctxOf(id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=abc`), ctxOf(id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=999`), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
  })

  it("干净删除 → 200 + deletedAt / version+1；列表隐藏、includeDeleted 可见；重复删除 404", async () => {
    const made = await createTag("p6a_标签_将被删除")
    const id = made.json.data!.id
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)
    const d = (await body<TagDto>(res)).data!
    expect(d.deletedAt).toBeTruthy()
    expect(d.version).toBe(2)

    const list = await body<PageResult<TagDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags")))
    expect(list.data!.items.some((i) => i.id === id)).toBe(false)
    const bin = await body<PageResult<TagDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/tags?includeDeleted=true&sortBy=id&sortDir=desc")),
    )
    expect(bin.data!.items.find((i) => i.id === id)?.deletedAt).toBeTruthy()

    const again = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=2`), ctxOf(id))
    expect(again.status).toBe(404)
  })

  it("恢复：deleted → 200 deletedAt=null；未删除再恢复 → 422；version 错 → 409；不存在 → 404；审计 after.deleted_at=null", async () => {
    const made = await createTag("p6a_标签_删了又恢复")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)

    const deleted = await getTagWithDeleted(id)
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: 999 }), ctxOf(id))
    expect(res.status).toBe(409)
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: deleted.version }), ctxOf(id))
    expect(res.status).toBe(200)
    expect((await body<TagDto>(res)).data!.deletedAt).toBeNull()

    const restored = (await getTag(id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: restored.version }), ctxOf(id))
    expect(res.status).toBe(422)

    res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags/9000000000000000444/restore", { version: 1 }), ctxOf("9000000000000000444"))
    expect(res.status).toBe(404)
    res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags/bad-id/restore", { version: 1 }), ctxOf("bad-id"))
    expect(res.status).toBe(422)

    const rows = await auditRows(env.pool, "tag.restore")
    expect(rows.some((r) => r.resource_id === id && auditJson(r.after_json)?.deleted_at === null)).toBe(true)
  })
})

describe("P6A 标签：RBAC 与 CSRF", () => {
  it("auditor：读 200；create/update/status/delete/restore/reorder 全部 403 FORBIDDEN", async () => {
    expect((await listRoute.GET(reqFor(auditor, "GET", "/api/admin/v1/tags"))).status).toBe(200)
    let res = await listRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/tags", { name: "p6a_标签_auditor写" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("FORBIDDEN")
    const any = T["p6a_标签_正规"]
    res = await itemRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/tags/${any.id}`, { name: "auditor改名", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await statusRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/tags/${any.id}/status`, { status: "active", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await itemRoute.DELETE(reqFor(auditor, "DELETE", `/api/admin/v1/tags/${any.id}?version=1`), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(auditor, "POST", `/api/admin/v1/tags/${any.id}/restore`, { version: 1 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await reorderRoute.PATCH(reqFor(auditor, "PATCH", "/api/admin/v1/tags/reorder", { items: [{ id: any.id, sortOrder: 1, version: 1 }] }))
    expect(res.status).toBe(403)
  })

  it("content_editor：read/create/update/status 200；delete 与 restore 403", async () => {
    const made = await createTag("p6a_标签_editor", { session: editor })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/tags/${id}`, { iconClass: "iconfont", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/tags/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(editor, "DELETE", `/api/admin/v1/tags/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(editor, "POST", `/api/admin/v1/tags/${id}/restore`, { version: 3 }), ctxOf(id))
    expect(res.status).toBe(403)
  })

  it("content_admin：全 CRUD 通过（create→update→disable→delete→restore）", async () => {
    const made = await createTag("p6a_标签_cadmin", { session: cadmin })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/tags/${id}`, { name: "p6a_标签_cadmin改名", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/tags/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(cadmin, "DELETE", `/api/admin/v1/tags/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(200)
    res = await restoreRoute.POST(reqFor(cadmin, "POST", `/api/admin/v1/tags/${id}/restore`, { version: 4 }), ctxOf(id))
    expect(res.status).toBe(200)
  })

  it("写请求缺 CSRF / 错 token → 403 CSRF_INVALID；未认证 → 401", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_无csrf" }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_错csrf" }, { csrfOverride: "bogus" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name: "p6a_标签_匿名" }, { noAuth: true }))
    expect(res.status).toBe(401)
  })
})

describe("P6A 标签：审计", () => {
  it("create 审计：resource_type=tag / actor 正确 / after 含颜色默认值", async () => {
    const rows = await auditRows(env.pool, "tag.create")
    const row = rows.find((r) => auditJson(r.after_json)?.name === "p6a_标签_正规")!
    expect(row.resource_type).toBe("tag")
    expect(String(row.actor_user_id)).toBe(String(su.admin.id))
    expect(row.before_json).toBeNull()
    expect(auditJson(row.after_json)).toMatchObject({ name: "p6a_标签_正规", color: "#000000", bg_color: "#ffffff", status: "active" })
    expect(row.request_id).toBeTruthy()
  })

  it("软删除审计 before.deleted_at=null / after.deleted_at 非空", async () => {
    const rows = await auditRows(env.pool, "tag.soft_delete")
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const r of rows) {
      expect(auditJson(r.before_json).deleted_at).toBeNull()
      expect(auditJson(r.after_json).deleted_at).toBeTruthy()
    }
  })
})

// ── P6A.1 缺陷修复回归（缺陷2：恢复名称冲突 + 数据库层防线）──────────────
describe("P6A.1 标签：恢复名称冲突（缺陷回归）", () => {
  async function deleteTag(id: string): Promise<Response> {
    const cur = (await getTag(id)).data!
    return itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/tags/${id}?version=${cur.version}`, undefined), ctxOf(id))
  }

  it("A) 软删除期间同名已被新建 → 恢复 409 TAG_NAME_CONFLICT；清障后重试 → 200", async () => {
    const made = await createTag("p6a1_标签同名恢复")
    const id = made.json.data!.id
    expect((await deleteTag(id)).status).toBe(200)
    // 名称让出 → 新建同名成功（预检查 + uq_site_tags_active_name 均放行）
    const blocker = await createTag("p6a1_标签同名恢复")
    expect(blocker.res.status).toBe(200)

    const deleted = await getTagWithDeleted(id)
    let res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: deleted.version }), ctxOf(id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("TAG_NAME_CONFLICT")
    expect(j.error?.message).toContain("p6a1_标签同名恢复")
    expect(j.error?.fields?.name).toBeTruthy() // 响应结构统一：fields 带原因

    expect((await deleteTag(blocker.json.data!.id)).status).toBe(200)
    const after = await getTagWithDeleted(id)
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: after.version }), ctxOf(id))
    expect(res.status).toBe(200)
    expect((await body<TagDto>(res)).data!.deletedAt).toBeNull()
  })

  it("B) 两条同名软删除行可共存；并发恢复 → 终态恰好一条未删除（UNIQUE 兜底，SQL 异常不透出）", async () => {
    const a = (await createTag("p6a1_标签并发恢复")).json.data!
    expect((await deleteTag(a.id)).status).toBe(200)
    const b = (await createTag("p6a1_标签并发恢复")).json.data! // 软删除让出名称 → 同名再建
    expect((await deleteTag(b.id)).status).toBe(200)
    // 两条 deleted 行同时存在（生成列 NULL 不参与 UNIQUE）
    const rows = await rawQuery<{ n: number }>(
      env.pool,
      "SELECT COUNT(*) AS n FROM site_tags WHERE name = ? AND deleted_at IS NOT NULL",
      ["p6a1_标签并发恢复"],
    )
    expect(Number(rows[0]!.n)).toBe(2)

    const activeCount = async (): Promise<number> => {
      const r = await rawQuery<{ n: number }>(
        env.pool,
        "SELECT COUNT(*) AS n FROM site_tags WHERE name = ? AND deleted_at IS NULL",
        ["p6a1_标签并发恢复"],
      )
      return Number(r[0]!.n)
    }
    const call = (id: string, v: number) =>
      restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: v }), ctxOf(id))

    const [r1, r2] = await Promise.all([
      call(a.id, (await getTagWithDeleted(a.id)).version),
      call(b.id, (await getTagWithDeleted(b.id)).version),
    ])
    for (const r of [r1, r2]) {
      if (r.status !== 200) expect(r.status).toBe(409) // 竞态失败也是业务 409，绝不 500
      if (r.status === 409) {
        const j = await body<never>(r)
        expect(["TAG_NAME_CONFLICT", "VERSION_CONFLICT"]).toContain(j.error?.code)
      }
    }
    const wins = [r1, r2].filter((r) => r.status === 200).length
    expect(wins).toBeLessThanOrEqual(1)
    expect(await activeCount()).toBe(wins)

    if (wins === 0) {
      // 死锁回滚 + purge 延迟幽灵记录的合法结局：管理员再点一次即可
      const [r3, r4] = await Promise.all([
        call(a.id, (await getTagWithDeleted(a.id)).version),
        call(b.id, (await getTagWithDeleted(b.id)).version),
      ])
      expect([r3.status, r4.status].filter((s) => s === 200).length).toBe(1)
    }
    expect(await activeCount()).toBe(1) // 数据库不变式：同名只有一条未删除
  })

  it("C) 软删除让出名称：同名 create 200；version 过期时恢复仍先报 VERSION_CONFLICT", async () => {
    const made = await createTag("p6a1_标签版本优先")
    const id = made.json.data!.id
    expect((await deleteTag(id)).status).toBe(200)
    expect((await createTag("p6a1_标签版本优先")).res.status).toBe(200)

    const deleted = await getTagWithDeleted(id)
    const res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/tags/${id}/restore`, { version: deleted.version + 100 }), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
  })
})
