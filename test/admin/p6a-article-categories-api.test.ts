// P6A §14.2 文章分类 API 全链路：CRUD / 全局排序 / 状态 / 软删除保护（含软删除文章）/ 恢复 /
// 乐观锁 / RBAC / CSRF / 审计（scratch 库，真实 route handler 调用）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ArticleCategoryDto, PageResult } from "../../src/lib/admin/dto/content.ts"
import {
  auditJson,
  auditRows,
  p6aLogin,
  rawQuery,
  reqFor,
  seedArticle,
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

const A: Record<string, ArticleCategoryDto> = {}

async function createAc(
  name: string,
  opts: { session?: P6aSession; extra?: Record<string, unknown>; key?: string } = {},
): Promise<{ res: Response; json: Envelope<ArticleCategoryDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", "/api/admin/v1/article-categories", {
      name,
      ...(opts.extra ?? {}),
    }),
  )
  const json = await body<ArticleCategoryDto>(res)
  if (res.status === 200 && json.data) A[opts.key ?? name] = json.data
  return { res, json }
}

async function getAc(id: string, session: P6aSession = su): Promise<Envelope<ArticleCategoryDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `/api/admin/v1/article-categories/${id}`), ctxOf(id)))
}

beforeAll(async () => {
  env = await setupP6aEnv()
  listRoute = await import("../../src/app/api/admin/v1/article-categories/route")
  reorderRoute = await import("../../src/app/api/admin/v1/article-categories/reorder/route")
  itemRoute = await import("../../src/app/api/admin/v1/article-categories/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/article-categories/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/article-categories/[id]/restore/route")
  su = await p6aLogin(env, "p6a_ac_super", ["super_admin"])
  auditor = await p6aLogin(env, "p6a_ac_auditor", ["auditor"])
  editor = await p6aLogin(env, "p6a_ac_editor", ["content_editor"])
  cadmin = await p6aLogin(env, "p6a_ac_cadmin", ["content_admin"])
}, 240_000)

afterAll(async () => {
  await teardownP6aEnv(env)
})

describe("P6A 文章分类：创建与校验", () => {
  it("创建 → 200，DTO 合同（字符串 id / version=1 / articleCount=0 / 无 updatedAt 泄漏）", async () => {
    const { res, json } = await createAc("p6a_文章_公告")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(typeof d.id).toBe("string")
    expect(d.name).toBe("p6a_文章_公告")
    expect(d.iconClass).toBe("")
    expect(d.sortOrder).toBe(1)
    expect(d.status).toBe("active")
    expect(d.version).toBe(1)
    expect(d.articleCount).toBe(0)
    expect(d.deletedAt).toBeNull()
    expect(typeof d.createdAt).toBe("string")
    expect(typeof d.updatedAt).toBe("string")
  })

  it("全局 sortOrder 自增；显式 sortOrder/status 生效", async () => {
    const second = await createAc("p6a_文章_资讯")
    expect(second.json.data!.sortOrder).toBe(2)
    const explicit = await createAc("p6a_文章_评测", { extra: { sortOrder: 77, status: "disabled" } })
    expect(explicit.json.data!.sortOrder).toBe(77)
    expect(explicit.json.data!.status).toBe("disabled")
  })

  it("名称全局唯一 → 422 fields.name；空名/非法字段 → 422", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_文章_公告" }))
    expect(res.status).toBe(422)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VALIDATION_ERROR")
    expect(j.error?.fields?.name).toBeTruthy()

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "" }))
    expect(res.status).toBe(422)
    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_文章_坏图标", iconClass: "<i>" }),
    )
    expect(res.status).toBe(422)
    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_文章_坏状态", status: "on" }),
    )
    expect(res.status).toBe(422)
    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_文章_坏排序", sortOrder: -5 }),
    )
    expect(res.status).toBe(422)
  })

  it("文章分类 ≠ 网址分类：独立资源（不要求 link_categories 有同名）", async () => {
    const { res } = await createAc("p6a_文章_与网址分类无关")
    expect(res.status).toBe(200)
  })
})

describe("P6A 文章分类：读取", () => {
  it("GET list：分页 meta / 默认 sortOrder asc / q / status", async () => {
    const all = await body<PageResult<ArticleCategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories?pageSize=20")),
    )
    expect(all.data!.page).toBe(1)
    expect(all.data!.pageSize).toBe(20)
    expect(all.data!.total).toBe(all.data!.items.length)
    expect(all.data!.items.map((i) => i.sortOrder)).toEqual([...all.data!.items.map((i) => i.sortOrder)].sort((a, b) => a - b))

    const q = await body<PageResult<ArticleCategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories?q=${encodeURIComponent("公告")}`)),
    )
    expect(q.data!.items.map((i) => i.id)).toEqual([A["p6a_文章_公告"].id])

    const disabled = await body<PageResult<ArticleCategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories?status=disabled")),
    )
    expect(disabled.data!.items.every((i) => i.status === "disabled")).toBe(true)
  })

  it("GET list 非法参数 → 422", async () => {
    for (const qs of ["pageSize=30", "sortBy=password", "sortDir=up", "page=0"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })

  it("GET 单条：非法 id → 422；不存在 → 404 ARTICLE_CATEGORY_NOT_FOUND", async () => {
    let res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories/abc"), ctxOf("abc"))
    expect(res.status).toBe(422)
    res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories/9000000000000000777"), ctxOf("9000000000000000777"))
    expect(res.status).toBe(404)
    expect((await body<never>(res)).error?.code).toBe("ARTICLE_CATEGORY_NOT_FOUND")
  })

  it("GET 未认证 → 401", async () => {
    const res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories", undefined, { noAuth: true }))
    expect(res.status).toBe(401)
  })
})

describe("P6A 文章分类：更新 / 乐观锁", () => {
  it("PATCH 改名+图标 → 200 version+1；审计 before/after", async () => {
    const cur = (await getAc(A["p6a_文章_资讯"].id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}`, {
        name: "p6a_文章_资讯改名",
        iconClass: "iconfont icon-news",
        version: cur.version,
      }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    const d = (await body<ArticleCategoryDto>(res)).data!
    expect(d.name).toBe("p6a_文章_资讯改名")
    expect(d.iconClass).toBe("iconfont icon-news")
    expect(d.version).toBe(cur.version + 1)

    const rows = await auditRows(env.pool, "article_category.update")
    const row = rows.find((r) => auditJson(r.after_json)?.name === "p6a_文章_资讯改名")!
    expect(auditJson(row.before_json).name).toBe("p6a_文章_资讯")
    expect(auditJson(row.after_json).icon_class).toBe("iconfont icon-news")
  })

  it("PATCH 旧 version → 409 VERSION_CONFLICT 固定文案；库内不回写", async () => {
    const cur = (await getAc(A["p6a_文章_资讯"].id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}`, { name: "p6a_不该成功", version: cur.version - 1 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VERSION_CONFLICT")
    expect(j.error?.message).toBe(VERSION_CONFLICT_MSG)
    const db = await rawQuery<{ name: string }>(env.pool, "SELECT name FROM article_categories WHERE id = ?", [cur.id])
    expect(db[0]!.name).toBe("p6a_文章_资讯改名")
  })

  it("PATCH 名称与他分类冲突 → 422 fields.name；空改动 → 422", async () => {
    let res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${A["p6a_文章_公告"].id}`, {
        name: "p6a_文章_评测",
        version: A["p6a_文章_公告"].version,
      }),
      ctxOf(A["p6a_文章_公告"].id),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.fields?.name).toBeTruthy()

    res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${A["p6a_文章_公告"].id}`, { version: A["p6a_文章_公告"].version }),
      ctxOf(A["p6a_文章_公告"].id),
    )
    expect(res.status).toBe(422)
  })

  it("PATCH 已删除分类 → 404", async () => {
    const made = await createAc("p6a_文章_删后改")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/article-categories/${id}`, { name: "p6a_改名失败", version: 2 }), ctxOf(id))
    expect(res.status).toBe(404)
  })
})

describe("P6A 文章分类：状态切换", () => {
  it("disable → 200 / enable → 200，审计 article_category.disable / .enable", async () => {
    const cur = (await getAc(A["p6a_文章_公告"].id)).data!
    let res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}/status`, { status: "disabled", version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    expect((await body<ArticleCategoryDto>(res)).data!.status).toBe("disabled")
    let rows = await auditRows(env.pool, "article_category.disable")
    expect(rows.some((r) => r.resource_id === cur.id && r.resource_type === "article_category")).toBe(true)

    const cur2 = (await getAc(cur.id)).data!
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}/status`, { status: "active", version: cur2.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    rows = await auditRows(env.pool, "article_category.enable")
    expect(rows.some((r) => r.resource_id === cur.id)).toBe(true)
  })

  it("status：旧 version → 409；非法 body → 422；GET → 405；不存在 → 404", async () => {
    const cur = (await getAc(A["p6a_文章_公告"].id)).data!
    let res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}/status`, { status: "disabled", version: 999999 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${cur.id}/status`, { status: "on", version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(422)
    expect((await statusRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories/${cur.id}/status`))).status).toBe(405)
    res = await statusRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/article-categories/9000000000000000888/status", { status: "disabled", version: 1 }),
      ctxOf("9000000000000000888"),
    )
    expect(res.status).toBe(404)
  })
})

describe("P6A 文章分类：全局批量排序", () => {
  it("交换 sortOrder → 200，version 各自 +1，审计 resourceId=global", async () => {
    const a = (await getAc(A["p6a_文章_公告"].id)).data!
    const b = (await getAc(A["p6a_文章_资讯"].id)).data!
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/article-categories/reorder", {
        items: [
          { id: a.id, sortOrder: 500, version: a.version },
          { id: b.id, sortOrder: 501, version: b.version },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const j = await body<{ records: ArticleCategoryDto[] }>(res)
    expect(j.data!.records.find((r) => r.id === a.id)!.sortOrder).toBe(500)
    expect(j.data!.records.find((r) => r.id === b.id)!.version).toBe(b.version + 1)
    const rows = await auditRows(env.pool, "article_category.reorder")
    expect(rows.some((r) => r.resource_id === "global")).toBe(true)
  })

  it("任一条 version 冲突 → 409 整批回滚（先成功条目也不生效、无审计）", async () => {
    const a = (await getAc(A["p6a_文章_公告"].id)).data!
    const b = await getAcByName("p6a_文章_资讯改名")
    const beforeAudit = (await auditRows(env.pool, "article_category.reorder")).length
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/article-categories/reorder", {
        items: [
          { id: a.id, sortOrder: 1, version: a.version },
          { id: b.id, sortOrder: 2, version: b.version + 5 },
        ],
      }),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
    expect((await getAc(A["p6a_文章_公告"].id)).data!.sortOrder).toBe(a.sortOrder)
    expect((await auditRows(env.pool, "article_category.reorder")).length).toBe(beforeAudit)
  })

  it("条目不存在 / 空数组 / id 重复 → 422/404", async () => {
    let res = await reorderRoute.PATCH(reqFor(su, "PATCH", "/api/admin/v1/article-categories/reorder", { items: [] }))
    expect(res.status).toBe(422)
    res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/article-categories/reorder", {
        items: [
          { id: "9000000000000000111", sortOrder: 0, version: 1 },
        ],
      }),
    )
    expect(res.status).toBe(404)
    res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/article-categories/reorder", {
        items: [
          { id: "10", sortOrder: 0, version: 1 },
          { id: "10", sortOrder: 1, version: 1 },
        ],
      }),
    )
    expect(res.status).toBe(422)
  })
})

async function getAcByName(name: string): Promise<ArticleCategoryDto> {
  const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories?q=${encodeURIComponent(name)}`))
  return (await body<PageResult<ArticleCategoryDto>>(res)).data!.items[0]!
}

describe("P6A 文章分类：软删除保护与恢复", () => {
  it("有文章（1 正常 + 1 软删除）→ 409 ARTICLE_CATEGORY_HAS_ARTICLES，消息含计数", async () => {
    const made = await createAc("p6a_文章_有文章")
    const id = made.json.data!.id
    await seedArticle(env.db, { categoryId: id, title: "p6a-art-1" })
    await seedArticle(env.db, { categoryId: id, title: "p6a-art-del", deleted: true })
    const cur = (await getAc(id)).data!
    expect(cur.articleCount).toBe(2)
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=${cur.version}`), ctxOf(id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("ARTICLE_CATEGORY_HAS_ARTICLES")
    expect(j.error?.message).toContain("2")
  })

  it("只有软删除文章也阻止删除", async () => {
    const made = await createAc("p6a_文章_仅软删文章")
    const id = made.json.data!.id
    await seedArticle(env.db, { categoryId: id, title: "p6a-art-del2", deleted: true })
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("ARTICLE_CATEGORY_HAS_ARTICLES")
  })

  it("DELETE 缺 version / 非法 version → 422；旧 version → 409", async () => {
    const made = await createAc("p6a_文章_干净删除")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}`), ctxOf(id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=x`), ctxOf(id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=999`), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
  })

  it("干净删除 → 200 + deletedAt / version+1；列表隐藏、includeDeleted 可见；重复删除 404", async () => {
    const made = await createAc("p6a_文章_将被删除")
    const id = made.json.data!.id
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)
    const d = (await body<ArticleCategoryDto>(res)).data!
    expect(d.deletedAt).toBeTruthy()
    expect(d.version).toBe(2)

    const list = await body<PageResult<ArticleCategoryDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories")))
    expect(list.data!.items.some((i) => i.id === id)).toBe(false)
    const bin = await body<PageResult<ArticleCategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/article-categories?includeDeleted=true&sortBy=id&sortDir=desc")),
    )
    expect(bin.data!.items.find((i) => i.id === id)?.deletedAt).toBeTruthy()

    const again = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=2`), ctxOf(id))
    expect(again.status).toBe(404)
  })

  it("恢复：deleted → 200 deletedAt=null；未删除再恢复 → 422；version 错 → 409；不存在 → 404", async () => {
    const made = await createAc("p6a_文章_删了又恢复")
    const id = made.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)

    const deleted = (await getAc(id)).data ?? (await getAcWithDeleted(id))
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: 999 }), ctxOf(id))
    expect(res.status).toBe(409)
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: deleted.version }), ctxOf(id))
    expect(res.status).toBe(200)
    expect((await body<ArticleCategoryDto>(res)).data!.deletedAt).toBeNull()

    // 重复恢复 → 422
    const restored = (await getAc(id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: restored.version }), ctxOf(id))
    expect(res.status).toBe(422)

    // 不存在 → 404；非法 id → 422
    res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories/9000000000000000654/restore", { version: 1 }), ctxOf("9000000000000000654"))
    expect(res.status).toBe(404)
    res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories/bad-id/restore", { version: 1 }), ctxOf("bad-id"))
    expect(res.status).toBe(422)

    // 审计
    const rows = await auditRows(env.pool, "article_category.restore")
    expect(rows.some((r) => r.resource_id === id && auditJson(r.after_json)?.deleted_at === null)).toBe(true)
  })
})

async function getAcWithDeleted(id: string): Promise<ArticleCategoryDto> {
  const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories?includeDeleted=true&sortBy=id&sortDir=desc`))
  return (await body<PageResult<ArticleCategoryDto>>(res)).data!.items.find((i) => i.id === id)!
}

describe("P6A 文章分类：RBAC 与 CSRF", () => {
  it("auditor：读 200；create/update/status/delete/restore/reorder 全部 403 FORBIDDEN", async () => {
    expect((await listRoute.GET(reqFor(auditor, "GET", "/api/admin/v1/article-categories"))).status).toBe(200)
    let res = await listRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/article-categories", { name: "p6a_ac_auditor写" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("FORBIDDEN")
    const any = A["p6a_文章_公告"]
    res = await itemRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/article-categories/${any.id}`, { name: "auditor改名", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await statusRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/article-categories/${any.id}/status`, { status: "active", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await itemRoute.DELETE(reqFor(auditor, "DELETE", `/api/admin/v1/article-categories/${any.id}?version=1`), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(auditor, "POST", `/api/admin/v1/article-categories/${any.id}/restore`, { version: 1 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await reorderRoute.PATCH(reqFor(auditor, "PATCH", "/api/admin/v1/article-categories/reorder", { items: [{ id: any.id, sortOrder: 1, version: 1 }] }))
    expect(res.status).toBe(403)
  })

  it("content_editor：read/create/update/status 200；delete 与 restore 403", async () => {
    const made = await createAc("p6a_ac_editor_cat", { session: editor })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/article-categories/${id}`, { iconClass: "iconfont", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/article-categories/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(editor, "DELETE", `/api/admin/v1/article-categories/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(editor, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: 3 }), ctxOf(id))
    expect(res.status).toBe(403)
  })

  it("content_admin：全 CRUD 通过（create→update→disable→delete→restore）", async () => {
    const made = await createAc("p6a_ac_cadmin_cat", { session: cadmin })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/article-categories/${id}`, { name: "p6a_ac_cadmin改名", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/article-categories/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(cadmin, "DELETE", `/api/admin/v1/article-categories/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(200)
    res = await restoreRoute.POST(reqFor(cadmin, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: 4 }), ctxOf(id))
    expect(res.status).toBe(200)
  })

  it("写请求缺 CSRF / 错 token → 403 CSRF_INVALID；未认证 → 401", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_ac_无csrf" }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_ac_错csrf" }, { csrfOverride: "bogus" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6a_ac_匿名" }, { noAuth: true }))
    expect(res.status).toBe(401)
  })
})

describe("P6A 文章分类：审计", () => {
  it("create 审计：resource_type=article_category / actor 正确 / after 含名称", async () => {
    const rows = await auditRows(env.pool, "article_category.create")
    const row = rows.find((r) => auditJson(r.after_json)?.name === "p6a_文章_公告")!
    expect(row.resource_type).toBe("article_category")
    expect(String(row.actor_user_id)).toBe(String(su.admin.id))
    expect(row.before_json).toBeNull()
    expect(auditJson(row.after_json)).toMatchObject({ name: "p6a_文章_公告", status: "active" })
    expect(row.request_id).toBeTruthy()
  })

  it("软删除审计 before.deleted_at=null / after.deleted_at 非空", async () => {
    const rows = await auditRows(env.pool, "article_category.soft_delete")
    expect(rows.length).toBeGreaterThanOrEqual(1)
    for (const r of rows) {
      expect(auditJson(r.before_json).deleted_at).toBeNull()
      expect(auditJson(r.after_json).deleted_at).toBeTruthy()
    }
  })
})

// ── P6A.1 缺陷修复回归（缺陷2：恢复名称冲突 + 数据库层防线）──────────────
describe("P6A.1 文章分类：恢复名称冲突（缺陷回归）", () => {
  async function deleteAc(id: string): Promise<Response> {
    const cur = (await getAc(id)).data!
    return itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/article-categories/${id}?version=${cur.version}`, undefined), ctxOf(id))
  }

  it("A) 软删除期间同名已被新建 → 恢复 409 ARTICLE_CATEGORY_NAME_CONFLICT；清障后重试 → 200", async () => {
    const made = await createAc("p6a1_文章同名恢复")
    const id = made.json.data!.id
    expect((await deleteAc(id)).status).toBe(200)
    // 名称让出 → 新建同名成功（预检查 + uq_article_categories_active_name 均放行）
    const blocker = await createAc("p6a1_文章同名恢复")
    expect(blocker.res.status).toBe(200)

    const deleted = await getAcWithDeleted(id)
    let res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: deleted.version }), ctxOf(id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("ARTICLE_CATEGORY_NAME_CONFLICT")
    expect(j.error?.message).toContain("p6a1_文章同名恢复")
    expect(j.error?.fields?.name).toBeTruthy() // 响应结构统一：fields 带原因

    expect((await deleteAc(blocker.json.data!.id)).status).toBe(200)
    const after = await getAcWithDeleted(id)
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: after.version }), ctxOf(id))
    expect(res.status).toBe(200)
    expect((await body<ArticleCategoryDto>(res)).data!.deletedAt).toBeNull()
  })

  it("B) 两条同名软删除行可共存；并发恢复 → 终态恰好一条未删除（UNIQUE 兜底，SQL 异常不透出）", async () => {
    const a = (await createAc("p6a1_文章并发恢复")).json.data!
    expect((await deleteAc(a.id)).status).toBe(200)
    const b = (await createAc("p6a1_文章并发恢复")).json.data! // 软删除让出名称 → 同名再建
    expect((await deleteAc(b.id)).status).toBe(200)
    // 两条 deleted 行同时存在（生成列 NULL 不参与 UNIQUE）
    const rows = await rawQuery<{ n: number }>(
      env.pool,
      "SELECT COUNT(*) AS n FROM article_categories WHERE name = ? AND deleted_at IS NOT NULL",
      ["p6a1_文章并发恢复"],
    )
    expect(Number(rows[0]!.n)).toBe(2)

    const activeCount = async (): Promise<number> => {
      const r = await rawQuery<{ n: number }>(
        env.pool,
        "SELECT COUNT(*) AS n FROM article_categories WHERE name = ? AND deleted_at IS NULL",
        ["p6a1_文章并发恢复"],
      )
      return Number(r[0]!.n)
    }
    const call = (id: string, v: number) =>
      restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: v }), ctxOf(id))

    const [r1, r2] = await Promise.all([
      call(a.id, (await getAcWithDeleted(a.id)).version),
      call(b.id, (await getAcWithDeleted(b.id)).version),
    ])
    for (const r of [r1, r2]) {
      if (r.status !== 200) expect(r.status).toBe(409) // 竞态失败也是业务 409，绝不 500
      if (r.status === 409) {
        const j = await body<never>(r)
        expect(["ARTICLE_CATEGORY_NAME_CONFLICT", "VERSION_CONFLICT"]).toContain(j.error?.code)
      }
    }
    const wins = [r1, r2].filter((r) => r.status === 200).length
    expect(wins).toBeLessThanOrEqual(1)
    expect(await activeCount()).toBe(wins)

    if (wins === 0) {
      // 死锁回滚 + purge 延迟幽灵记录的合法结局：管理员再点一次即可
      const [r3, r4] = await Promise.all([
        call(a.id, (await getAcWithDeleted(a.id)).version),
        call(b.id, (await getAcWithDeleted(b.id)).version),
      ])
      expect([r3.status, r4.status].filter((s) => s === 200).length).toBe(1)
    }
    expect(await activeCount()).toBe(1) // 数据库不变式：同名只有一条未删除
  })

  it("C) 软删除让出名称：同名 create 200；version 过期时恢复仍先报 VERSION_CONFLICT", async () => {
    const made = await createAc("p6a1_文章版本优先")
    const id = made.json.data!.id
    expect((await deleteAc(id)).status).toBe(200)
    expect((await createAc("p6a1_文章版本优先")).res.status).toBe(200)

    const deleted = await getAcWithDeleted(id)
    const res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${id}/restore`, { version: deleted.version + 100 }), ctxOf(id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
  })
})
