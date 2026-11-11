// P6A §14.2 网址分类 API 全链路：CRUD / 两级树 / 排序 / 状态级联 / 软删除保护 / 恢复 /
// 乐观锁 / RBAC 矩阵 / CSRF / 审计同事务回滚（scratch 库，真实 route handler 调用）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { CategoryDto, CategoryTreeNodeDto, PageResult } from "../../src/lib/admin/dto/content.ts"
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
let su: P6aSession // super_admin
let auditor: P6aSession
let editor: P6aSession
let cadmin: P6aSession // content_admin

let listRoute: { GET: R1; POST: R1 }
let treeRoute: { GET: R1 }
let reorderRoute: { PATCH: R1 }
let itemRoute: { GET: R2; PATCH: R2; DELETE: R2 }
let statusRoute: { GET: R1; PATCH: R2 }
let restoreRoute: { POST: R2 }

/** 测试夹具：按顺序共享（vitest 同文件内串行） */
const C: Record<string, CategoryDto> = {}

async function createCat(
  name: string,
  opts: { parentId?: string | null; session?: P6aSession; extra?: Record<string, unknown>; key?: string } = {},
): Promise<{ res: Response; json: Envelope<CategoryDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", "/api/admin/v1/categories", {
      name,
      ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
      ...(opts.extra ?? {}),
    }),
  )
  const json = await body<CategoryDto>(res)
  if (res.status === 200 && json.data) C[opts.key ?? name] = json.data
  return { res, json }
}

async function getCat(id: string, session: P6aSession = su): Promise<Envelope<CategoryDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `/api/admin/v1/categories/${id}`), ctxOf(id)))
}

beforeAll(async () => {
  env = await setupP6aEnv()
  listRoute = await import("../../src/app/api/admin/v1/categories/route")
  treeRoute = await import("../../src/app/api/admin/v1/categories/tree/route")
  reorderRoute = await import("../../src/app/api/admin/v1/categories/reorder/route")
  itemRoute = await import("../../src/app/api/admin/v1/categories/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/categories/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/categories/[id]/restore/route")
  su = await p6aLogin(env, "p6a_cat_super", ["super_admin"])
  auditor = await p6aLogin(env, "p6a_cat_auditor", ["auditor"])
  editor = await p6aLogin(env, "p6a_cat_editor", ["content_editor"])
  cadmin = await p6aLogin(env, "p6a_cat_cadmin", ["content_admin"])
}, 240_000)

afterAll(async () => {
  await teardownP6aEnv(env)
})

describe("P6A 分类：创建与两级结构校验", () => {
  it("创建一级分类 → 200，DTO 合同（字符串 id / version=1 / count=0）", async () => {
    const { res, json } = await createCat("p6a_一级A")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(typeof d.id).toBe("string")
    expect(d.parentId).toBeNull()
    expect(d.status).toBe("active")
    expect(d.version).toBe(1)
    expect(d.linkCount).toBe(0)
    expect(d.childCount).toBe(0)
    expect(d.deletedAt).toBeNull()
    expect(typeof d.createdAt).toBe("string")
  })

  it("创建二级分类 → parentId 生效；sortOrder 缺省=作用域 max+1", async () => {
    const a = await createCat("p6a_一级B")
    expect(a.res.status).toBe(200)
    const { res, json } = await createCat("p6a_二级A1", { parentId: C["p6a_一级A"].id })
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.parentId).toBe(C["p6a_一级A"].id)
    expect(d.sortOrder).toBe(1)
    const second = await createCat("p6a_二级A2", { parentId: C["p6a_一级A"].id })
    expect(second.json.data!.sortOrder).toBe(2)
  })

  it("显式 sortOrder / status 生效", async () => {
    const { res, json } = await createCat("p6a_一级S", { extra: { sortOrder: 50, status: "disabled" } })
    expect(res.status).toBe(200)
    expect(json.data!.sortOrder).toBe(50)
    expect(json.data!.status).toBe("disabled")
  })

  it("字段校验：缺名称 / 空名称 / 非法 sortOrder → 422 + fields", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { parentId: null }))
    expect(res.status).toBe(422)
    let j = await body<never>(res)
    expect(j.error?.code).toBe("VALIDATION_ERROR")
    expect(j.error?.fields?.name).toBeTruthy()

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "   " }))
    expect(res.status).toBe(422)

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_坏排序", sortOrder: -1 }))
    expect(res.status).toBe(422)
    j = await body<never>(res)
    expect(j.error?.fields?.sortOrder).toBeTruthy()

    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_坏图标", iconClass: "<b>x</b>" }))
    expect(res.status).toBe(422)
  })

  it("父级校验：不存在 → 422 CATEGORY_PARENT_NOT_FOUND；二级作父 → 422 CATEGORY_PARENT_NOT_LEVEL_ONE", async () => {
    let res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_孤儿", parentId: "9000000000000000123" }),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_PARENT_NOT_FOUND")

    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_三级", parentId: C["p6a_二级A1"].id }),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_PARENT_NOT_LEVEL_ONE")
  })

  it("同一作用域同名 → 422（fields.name）；不同作用域同名允许", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_一级A" }))
    expect(res.status).toBe(422)
    const j = await body<never>(res)
    expect(j.error?.fields?.name).toBeTruthy()

    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_一级A", parentId: C["p6a_一级B"].id }),
    )
    expect(res.status).toBe(200)
    C.dupUnderB = (await body<CategoryDto>(res)).data!
  })
})

describe("P6A 分类：引用计数与树/列表读取", () => {
  it("种子网址（1 正常 + 1 软删除）→ linkCount=2（含软删除），childCount=2", async () => {
    await seedLink(env.db, { categoryId: C["p6a_二级A1"].id, title: "p6a-link-1" })
    await seedLink(env.db, { categoryId: C["p6a_二级A1"].id, title: "p6a-link-del", deleted: true })
    const j = await getCat(C["p6a_一级A"].id)
    expect(j.data!.childCount).toBe(2)
    expect(j.data!.linkCount).toBe(0)
    const child = await getCat(C["p6a_二级A1"].id)
    expect(child.data!.linkCount).toBe(2)
  })

  it("GET tree：两级嵌套；q 命中子分类时保留祖先；无命中 → 空树", async () => {
    const j = await body<{ tree: CategoryTreeNodeDto[] }>(
      await treeRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/tree")),
    )
    const tree = j.data!.tree
    const rootA = tree.find((n) => n.id === C["p6a_一级A"].id)
    expect(rootA).toBeTruthy()
    expect(rootA!.children.map((c) => c.id).sort()).toEqual([C["p6a_二级A1"].id, C["p6a_二级A2"].id].sort())

    const q = await body<{ tree: CategoryTreeNodeDto[] }>(
      await treeRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories/tree?q=${encodeURIComponent("二级A1")}`)),
    )
    const filtered = q.data!.tree
    expect(filtered.length).toBe(1)
    expect(filtered[0]!.id).toBe(C["p6a_一级A"].id)
    expect(filtered[0]!.children.length).toBe(1)
    expect(filtered[0]!.children[0]!.id).toBe(C["p6a_二级A1"].id)

    const none = await body<{ tree: CategoryTreeNodeDto[] }>(
      await treeRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/tree?q=no_such_term_xyz")),
    )
    expect(none.data!.tree).toEqual([])

    const st = await body<{ tree: CategoryTreeNodeDto[] }>(
      await treeRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/tree?status=disabled")),
    )
    expect(st.data!.tree.every((n) => n.status === "disabled")).toBe(true)
    expect(st.data!.tree.some((n) => n.id === C["p6a_一级S"].id)).toBe(true)
  })

  it("GET tree 非法参数 → 422", async () => {
    const res = await treeRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/tree?status=on"))
    expect(res.status).toBe(422)
  })

  it("GET list：分页 meta / 默认排序 sortOrder asc / q / status / parentId", async () => {
    const all = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories?page=1&pageSize=20")),
    )
    const items = all.data!.items
    expect(all.data!.page).toBe(1)
    expect(all.data!.pageSize).toBe(20)
    expect(all.data!.total).toBe(items.length)
    expect(items.map((i) => i.sortOrder)).toEqual([...items.map((i) => i.sortOrder)].sort((a, b) => a - b))

    const byId = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories?q=${encodeURIComponent("二级A1")}`)),
    )
    expect(byId.data!.items.map((i) => i.id)).toEqual([C["p6a_二级A1"].id])

    const disabled = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories?status=disabled")),
    )
    expect(disabled.data!.items.every((i) => i.status === "disabled")).toBe(true)

    const topLevel = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories?parentId=none")),
    )
    expect(topLevel.data!.items.every((i) => i.parentId === null)).toBe(true)
    expect(topLevel.data!.items.some((i) => i.id === C["p6a_一级A"].id)).toBe(true)

    const underA = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories?parentId=${C["p6a_一级A"].id}`)),
    )
    expect(underA.data!.items.map((i) => i.id).sort()).toEqual([C["p6a_二级A1"].id, C["p6a_二级A2"].id].sort())
  })

  it("GET list：非法分页/排序/parentId 组合 → 422", async () => {
    for (const qs of ["pageSize=30", "sortBy=password", "sortDir=up", "includeDeleted=maybe", "parentId=none&includeDeleted=true"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })

  it("GET 单条：非法 id → 422；不存在 → 404 CATEGORY_NOT_FOUND", async () => {
    let res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/abc"), ctxOf("abc"))
    expect(res.status).toBe(422)
    res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/9000000000000000456"), ctxOf("9000000000000000456"))
    expect(res.status).toBe(404)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_NOT_FOUND")
  })

  it("GET list 未认证 → 401", async () => {
    const res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories", undefined, { noAuth: true }))
    expect(res.status).toBe(401)
  })
})

describe("P6A 分类：更新 / 移动 / 乐观锁", () => {
  it("PATCH 改名+图标 → 200，version+1", async () => {
    const cur = (await getCat(C["p6a_一级B"].id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, {
        name: "p6a_一级B改名",
        iconClass: "iconfont icon-coin",
        version: cur.version,
      }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    const d = (await body<CategoryDto>(res)).data!
    expect(d.name).toBe("p6a_一级B改名")
    expect(d.iconClass).toBe("iconfont icon-coin")
    expect(d.version).toBe(cur.version + 1)
  })

  it("PATCH 旧 version → 409 VERSION_CONFLICT（固定文案）", async () => {
    const cur = (await getCat(C["p6a_一级B"].id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { name: "p6a_不该成功", version: cur.version - 1 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VERSION_CONFLICT")
    expect(j.error?.message).toBe(VERSION_CONFLICT_MSG)
  })

  it("PATCH 空改动（仅 version）→ 422；非法 id → 422", async () => {
    const cur = (await getCat(C["p6a_一级B"].id)).data!
    let res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { version: cur.version }), ctxOf(cur.id))
    expect(res.status).toBe(422)
    res = await itemRoute.PATCH(reqFor(su, "PATCH", "/api/admin/v1/categories/xyz", { name: "x", version: 1 }), ctxOf("xyz"))
    expect(res.status).toBe(422)
  })

  it("移动到自身 → 422 CATEGORY_CYCLE", async () => {
    const cur = (await getCat(C["p6a_一级A"].id)).data!
    const res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { parentId: cur.id, version: cur.version }), ctxOf(cur.id))
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_CYCLE")
  })

  it("二级分类提升为一级再移回", async () => {
    let cur = (await getCat(C["p6a_二级A2"].id)).data!
    let res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { parentId: null, version: cur.version }), ctxOf(cur.id))
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.parentId).toBeNull()
    cur = (await getCat(C["p6a_二级A2"].id)).data!
    res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { parentId: C["p6a_一级A"].id, version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.parentId).toBe(C["p6a_一级A"].id)
  })

  it("有子分类的一级不能变成二级 → 409 CATEGORY_CYCLE（三级结构保护）", async () => {
    const e1 = await createCat("p6a_一级E")
    expect(e1.res.status).toBe(200)
    const e2 = await createCat("p6a_二级E1", { parentId: e1.json.data!.id })
    expect(e2.res.status).toBe(200)
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${e1.json.data!.id}`, { parentId: C["p6a_一级B"].id, version: 1 }),
      ctxOf(e1.json.data!.id),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_CYCLE")
  })

  it("移动到新作用域的同名冲突也检测 → 422", async () => {
    const dup = C.dupUnderB // 「p6a_一级A」挂在一级B下（同名不同作用域，前面创建成功）
    const cur = (await getCat(dup.id)).data!
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { parentId: null, version: cur.version }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.fields?.name).toBeTruthy()
  })

  it("移动到已删除父级 → 422 CATEGORY_PARENT_NOT_FOUND", async () => {
    const clean = await createCat("p6a_二级A4", { parentId: C["p6a_一级A"].id })
    const cid = clean.json.data!.id
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cid}?version=1`), ctxOf(cid))
    expect(res.status).toBe(200)
    const e1 = (await getCat(C["p6a_一级E"].id)).data!
    res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${e1.id}`, { parentId: cid, version: e1.version }),
      ctxOf(e1.id),
    )
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_PARENT_NOT_FOUND")
  })
})

async function getCatByIdName(name: string): Promise<CategoryDto> {
  const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories?q=${encodeURIComponent(name)}`))
  return (await body<PageResult<CategoryDto>>(res)).data!.items[0]!
}

describe("P6A 分类：状态切换与停用级联", () => {
  beforeAll(async () => {
    await createCat("p6a_一级St")
    await createCat("p6a_二级St1", { parentId: C["p6a_一级St"].id })
    await createCat("p6a_二级St2", { parentId: C["p6a_一级St"].id })
  })

  it("停用一级 → 同一事务级联停用二级（version 各自 +1，审计记条数）", async () => {
    const parent = (await getCat(C["p6a_一级St"].id)).data!
    const res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${parent.id}/status`, { status: "disabled", version: parent.version }),
      ctxOf(parent.id),
    )
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.status).toBe("disabled")

    const c1 = (await getCat(C["p6a_二级St1"].id)).data!
    const c2 = (await getCat(C["p6a_二级St2"].id)).data!
    expect(c1.status).toBe("disabled")
    expect(c2.status).toBe("disabled")

    const rows = await auditRows(env.pool, "category.disable")
    const row = rows.find((r) => r.resource_id === parent.id)!
    expect(auditJson(row.after_json).cascaded_disabled_children).toBe(2)
    expect(auditJson(row.before_json)).toEqual({ status: "active" })
  })

  it("父停用期间启用二级 → 409 VALIDATION_ERROR（上级停用提示）", async () => {
    const c1 = (await getCat(C["p6a_二级St1"].id)).data!
    const res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${c1.id}/status`, { status: "active", version: c1.version }),
      ctxOf(c1.id),
    )
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VALIDATION_ERROR")
    expect(j.error?.message).toContain("处于停用状态")
  })

  it("启用一级 → 200（不自动级联恢复二级）；再启用二级 → 200", async () => {
    const parent = (await getCat(C["p6a_一级St"].id)).data!
    const res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${parent.id}/status`, { status: "active", version: parent.version }),
      ctxOf(parent.id),
    )
    expect(res.status).toBe(200)
    const stillDisabled = (await getCat(C["p6a_二级St1"].id)).data!
    expect(stillDisabled.status).toBe("disabled")
    const res2 = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${stillDisabled.id}/status`, { status: "active", version: stillDisabled.version }),
      ctxOf(stillDisabled.id),
    )
    expect(res2.status).toBe(200)
  })

  it("status：旧 version → 409；非法 body → 422；GET 方法 → 405", async () => {
    const parent = (await getCat(C["p6a_一级St"].id)).data!
    let res = await statusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${parent.id}/status`, { status: "disabled", version: 999999 }),
      ctxOf(parent.id),
    )
    expect(res.status).toBe(409)
    res = await statusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${parent.id}/status`, { status: "on", version: parent.version }), ctxOf(parent.id))
    expect(res.status).toBe(422)
    expect((await statusRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories/${parent.id}/status`))).status).toBe(405)
  })
})

describe("P6A 分类：批量排序（作用域 + 整批回滚）", () => {
  it("一级作用域交换 sortOrder → 200，version 各自 +1", async () => {
    const a = (await getCat(C["p6a_一级A"].id)).data!
    const b = (await getCat(C["p6a_一级B"].id)).data!
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/categories/reorder", {
        parentId: null,
        items: [
          { id: a.id, sortOrder: 900, version: a.version },
          { id: b.id, sortOrder: 901, version: b.version },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const j = await body<{ records: CategoryDto[] }>(res)
    expect(j.data!.records.find((r) => r.id === a.id)!.sortOrder).toBe(900)
    expect(j.data!.records.find((r) => r.id === b.id)!.version).toBe(b.version + 1)
  })

  it("跨作用域混排 → 409 REORDER_SCOPE_MISMATCH 且整批回滚、无审计", async () => {
    const before = (await getCat(C["p6a_一级A"].id)).data!
    const rowsBefore = (await auditRows(env.pool, "category.reorder")).length
    const child = (await getCat(C["p6a_二级A1"].id)).data!
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/categories/reorder", {
        parentId: null,
        items: [
          { id: before.id, sortOrder: 999, version: before.version }, // 合法且先执行
          { id: child.id, sortOrder: 1000, version: child.version }, // 二级不在一级作用域
        ],
      }),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("REORDER_SCOPE_MISMATCH")
    const after = (await getCat(C["p6a_一级A"].id)).data!
    expect(after.sortOrder).toBe(before.sortOrder) // 回滚
    expect(after.version).toBe(before.version)
    expect((await auditRows(env.pool, "category.reorder")).length).toBe(rowsBefore)
  })

  it("任一条 version 冲突 → 409 整批回滚", async () => {
    const a = (await getCat(C["p6a_一级A"].id)).data!
    const b = (await getCat(C["p6a_一级B"].id)).data!
    const res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/categories/reorder", {
        parentId: null,
        items: [
          { id: a.id, sortOrder: 901, version: a.version },
          { id: b.id, sortOrder: 900, version: b.version + 5 },
        ],
      }),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
    expect((await getCat(C["p6a_一级A"].id)).data!.sortOrder).toBe(a.sortOrder)
  })

  it("reorder 缺 parentId / items 为空 / id 重复 → 422", async () => {
    let res = await reorderRoute.PATCH(reqFor(su, "PATCH", "/api/admin/v1/categories/reorder", { items: [] }))
    expect(res.status).toBe(422)
    res = await reorderRoute.PATCH(
      reqFor(su, "PATCH", "/api/admin/v1/categories/reorder", {
        parentId: null,
        items: [
          { id: "1", sortOrder: 0, version: 1 },
          { id: "1", sortOrder: 1, version: 1 },
        ],
      }),
    )
    expect(res.status).toBe(422)
  })
})

describe("P6A 分类：软删除保护与恢复", () => {
  it("有网址（含软删除）→ 409 CATEGORY_HAS_LINKS，消息含计数", async () => {
    const cur = (await getCat(C["p6a_二级A1"].id)).data!
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}?version=${cur.version}`), ctxOf(cur.id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("CATEGORY_HAS_LINKS")
    expect(j.error?.message).toContain("2")
  })

  it("只有软删除网址也阻止删除", async () => {
    await seedLink(env.db, { categoryId: C["p6a_二级A2"].id, title: "p6a-link-del2", deleted: true })
    const cur = (await getCat(C["p6a_二级A2"].id)).data!
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}?version=${cur.version}`), ctxOf(cur.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_HAS_LINKS")
  })

  it("有未删除子分类 → 409 CATEGORY_HAS_CHILDREN", async () => {
    const cur = (await getCat(C["p6a_一级A"].id)).data!
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}?version=${cur.version}`), ctxOf(cur.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_HAS_CHILDREN")
  })

  it("DELETE 缺 version / 非法 version → 422；旧 version → 409", async () => {
    const cur = (await getCat(C["p6a_二级A1"].id)).data!
    let res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}`), ctxOf(cur.id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}?version=abc`), ctxOf(cur.id))
    expect(res.status).toBe(422)
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${cur.id}?version=${cur.version + 100}`), ctxOf(cur.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")
  })

  it("干净二级删除 → 200 + deletedAt；列表默认隐藏、includeDeleted 可见；树隐藏", async () => {
    const made = await createCat("p6a_二级Clean", { parentId: C["p6a_一级B"].id })
    const id = made.json.data!.id
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${id}?version=1`), ctxOf(id))
    expect(res.status).toBe(200)
    const d = (await body<CategoryDto>(res)).data!
    expect(d.deletedAt).toBeTruthy()
    expect(d.version).toBe(2)

    const list = await body<PageResult<CategoryDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories")))
    expect(list.data!.items.some((i) => i.id === id)).toBe(false)
    const bin = await body<PageResult<CategoryDto>>(
      await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories?includeDeleted=true&sortBy=id&sortDir=desc")),
    )
    const row = bin.data!.items.find((i) => i.id === id)
    expect(row?.deletedAt).toBeTruthy()

    const tree = await body<{ tree: CategoryTreeNodeDto[] }>(await treeRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories/tree")))
    const walk = (ns: CategoryTreeNodeDto[]): boolean => ns.some((n) => n.id === id || walk(n.children))
    expect(walk(tree.data!.tree)).toBe(false)

    // 重复删除 → 404
    const again = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${id}?version=2`), ctxOf(id))
    expect(again.status).toBe(404)
  })

  it("恢复流程：删除二级+一级 → 恢复二级被阻（父未恢复）→ 恢复一级 → 恢复二级", async () => {
    const st = C["p6a_一级St"]
    const s1 = C["p6a_二级St1"]
    const s2 = await getCatByIdName("p6a_二级St2") // 现挂一级St 下
    // 把 St2 挪走，让 St 只剩 St1 子分类
    let res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${s2.id}`, { parentId: C["p6a_一级B"].id, version: s2.version }), ctxOf(s2.id))
    expect(res.status).toBe(200)
    // 删 St1
    const s1cur = (await getCat(s1.id)).data!
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${s1cur.id}?version=${s1cur.version}`), ctxOf(s1cur.id))
    expect(res.status).toBe(200)
    // 删 St（无未删除子分类、无网址）
    const stcur = (await getCat(st.id)).data!
    res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${stcur.id}?version=${stcur.version}`), ctxOf(stcur.id))
    expect(res.status).toBe(200)
    // 恢复 St1 → 被阻
    const s1after = (await getCat(s1.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${s1.id}/restore`, { version: s1after.version }), ctxOf(s1.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_RESTORE_BLOCKED")
    // 恢复 St
    const stafter = (await getCat(st.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${st.id}/restore`, { version: stafter.version }), ctxOf(st.id))
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.deletedAt).toBeNull()
    // 恢复 St1
    const s1after2 = (await getCat(s1.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${s1.id}/restore`, { version: s1after2.version }), ctxOf(s1.id))
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.deletedAt).toBeNull()
    // 重复恢复 → 422
    const s1after3 = (await getCat(s1.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${s1.id}/restore`, { version: s1after3.version }), ctxOf(s1.id))
    expect(res.status).toBe(422)
    // 恢复 version 错误 → 409（对 Clean 分类）
    const clean = await getCatByNameWithDeleted("p6a_二级Clean")
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${clean.id}/restore`, { version: 999 }), ctxOf(clean.id))
    expect(res.status).toBe(409)
  })

  it("恢复不存在的分类 → 404 CATEGORY_NOT_FOUND；非法 id → 422", async () => {
    let res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories/9000000000000000321/restore", { version: 1 }), ctxOf("9000000000000000321"))
    expect(res.status).toBe(404)
    res = await restoreRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories/bad-id/restore", { version: 1 }), ctxOf("bad-id"))
    expect(res.status).toBe(422)
  })

  it("删除不级联恢复子分类：一级删除要求先清空子（上面已验证 CATEGORY_HAS_CHILDREN）", async () => {
    // 直接删除仍有已删子分类的一级（St：St1 已恢复 → 阻止；证明计数只看未删除子）
    const st = C["p6a_一级St"]
    const res = await itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${st.id}?version=${(await getCat(st.id)).data!.version}`), ctxOf(st.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_HAS_CHILDREN")
  })
})

// ── P6A.1 缺陷修复回归（任务书 §缺陷1/缺陷2 的 8 项场景）──────────────
describe("P6A.1 分类：停用父级保护 + 恢复名称冲突（缺陷回归）", () => {
  async function disableCat(id: string): Promise<Response> {
    const cur = (await getCat(id)).data!
    return statusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${id}/status`, { status: "disabled", version: cur.version }), ctxOf(id))
  }
  async function enableCat(id: string): Promise<Response> {
    const cur = (await getCat(id)).data!
    return statusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${id}/status`, { status: "active", version: cur.version }), ctxOf(id))
  }
  async function deleteCat(id: string): Promise<Response> {
    const cur = (await getCat(id)).data!
    return itemRoute.DELETE(reqFor(su, "DELETE", `/api/admin/v1/categories/${id}?version=${cur.version}`, undefined), ctxOf(id))
  }

  it("1) 停用一级下新建启用二级 → 409 CATEGORY_PARENT_DISABLED", async () => {
    const p = await createCat("p6a1_停用父A")
    expect(p.res.status).toBe(200)
    expect((await disableCat(p.json.data!.id)).status).toBe(200)

    const made = await createCat("p6a1_不该成功", { parentId: p.json.data!.id })
    expect(made.res.status).toBe(409)
    expect(made.json.error?.code).toBe("CATEGORY_PARENT_DISABLED") // createCat 已消费 body，复用返回的 json
  })

  it("2) 停用一级下显式新建停用二级 → 200（停用挂停用允许）；启用它仍 409", async () => {
    const p = C["p6a1_停用父A"]
    const made = await createCat("p6a1_停用子挂停用", { parentId: p.id, extra: { status: "disabled" } })
    expect(made.res.status).toBe(200)
    expect(made.json.data!.status).toBe("disabled")

    const cur = made.json.data!
    const res = await statusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}/status`, { status: "active", version: cur.version }), ctxOf(cur.id))
    expect(res.status).toBe(409)
    const j = await body<never>(res)
    expect(j.error?.code).toBe("VALIDATION_ERROR") // 状态端点既有契约保持
    expect(j.error?.message).toContain("处于停用状态")
  })

  it("3) 停用一级级联：子分类 version 各自 +1（同事务）", async () => {
    const p = await createCat("p6a1_级联父")
    const c1 = await createCat("p6a1_级联子1", { parentId: p.json.data!.id })
    const c2 = await createCat("p6a1_级联子2", { parentId: p.json.data!.id })
    const before1 = (await getCat(c1.json.data!.id)).data!
    const before2 = (await getCat(c2.json.data!.id)).data!

    expect((await disableCat(p.json.data!.id)).status).toBe(200)
    const after1 = (await getCat(c1.json.data!.id)).data!
    const after2 = (await getCat(c2.json.data!.id)).data!
    expect(after1.status).toBe("disabled")
    expect(after2.status).toBe("disabled")
    expect(after1.version).toBe(before1.version + 1)
    expect(after2.version).toBe(before2.version + 1)
  })

  it("4) 移动：启用二级移入停用一级 → 409 CATEGORY_PARENT_DISABLED；停用二级移入 → 200", async () => {
    const disabledParent = C["p6a1_停用父A"]
    const activeParent = (await createCat("p6a1_移动父B")).json.data!
    const activeChild = (await createCat("p6a1_移动活跃子", { parentId: activeParent.id })).json.data!
    let res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${activeChild.id}`, { parentId: disabledParent.id, version: activeChild.version }), ctxOf(activeChild.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_PARENT_DISABLED")

    const disabledChild = (await createCat("p6a1_移动停用子", { parentId: activeParent.id, extra: { status: "disabled" } })).json.data!
    res = await itemRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${disabledChild.id}`, { parentId: disabledParent.id, version: disabledChild.version }), ctxOf(disabledChild.id))
    expect(res.status).toBe(200)
    expect((await getCat(disabledChild.id)).data!.parentId).toBe(disabledParent.id)
  })

  it("5) 恢复：启用二级 + 停用一级 → 409 CATEGORY_PARENT_DISABLED；启用一级后重试 → 200", async () => {
    const p = (await createCat("p6a1_恢复父")).json.data!
    const child = (await createCat("p6a1_恢复子A", { parentId: p.id })).json.data!
    expect((await deleteCat(child.id)).status).toBe(200) // 删除后存储状态仍为 active
    expect((await disableCat(p.id)).status).toBe(200) // 级联不影响已删除行

    const deleted = (await getCat(child.id)).data!
    let res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${child.id}/restore`, { version: deleted.version }), ctxOf(child.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_PARENT_DISABLED")

    expect((await enableCat(p.id)).status).toBe(200)
    const after = (await getCat(child.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${child.id}/restore`, { version: after.version }), ctxOf(child.id))
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.deletedAt).toBeNull()
  })

  it("6) 恢复同名：同级占用 → 409 CATEGORY_NAME_CONFLICT；不同父级不受影响；清障后重试 → 200", async () => {
    const p = (await createCat("p6a1_冲突父")).json.data!
    const other = (await createCat("p6a1_另一父")).json.data!
    const original = (await createCat("p6a1_同名子", { parentId: p.id })).json.data!
    expect((await deleteCat(original.id)).status).toBe(200)
    // 软删除让出名称 → 新建同名成功
    const blocker = (await createCat("p6a1_同名子", { parentId: p.id, key: "blocker" })).json.data!
    // 不同父级同名不受影响（uq 作用域 = parent_scope_id）
    const diffParent = await createCat("p6a1_同名子", { parentId: other.id })
    expect(diffParent.res.status).toBe(200)

    const deleted = (await getCat(original.id)).data!
    let res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${original.id}/restore`, { version: deleted.version }), ctxOf(original.id))
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("CATEGORY_NAME_CONFLICT")

    expect((await deleteCat(blocker.id)).status).toBe(200)
    const after = (await getCat(original.id)).data!
    res = await restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${original.id}/restore`, { version: after.version }), ctxOf(original.id))
    expect(res.status).toBe(200)
    expect((await body<CategoryDto>(res)).data!.deletedAt).toBeNull()
  })

  it("7) 并发：停用一级 vs 其下新建启用二级 → 终态不存在“启用子挂停用父”", async () => {
    const p = (await createCat("p6a1_并发父")).json.data!
    const [disableRes, createRes] = await Promise.all([
      disableCat(p.id),
      createCat("p6a1_并发新建子", { parentId: p.id }),
    ])
    // 两种合法结局：停用先行 → 新建 409；新建先行 → 新建 200 但被停用级联带上
    const dis = disableRes.status
    const crt = createRes.res.status
    expect((dis === 200 && (crt === 200 || crt === 409))).toBe(true)
    expect((await getCat(p.id)).data!.status).toBe("disabled")
    if (crt === 200) {
      expect((await getCat(createRes.json.data!.id)).data!.status).toBe("disabled")
    } else {
      expect(createRes.json.error?.code).toBe("CATEGORY_PARENT_DISABLED")
    }
  })

  it("8) 并发恢复：两条同名软删除一级 → 终态恰好一条未删除（UNIQUE 兜底）", async () => {
    const a = (await createCat("p6a1_并发恢复")).json.data!
    expect((await deleteCat(a.id)).status).toBe(200)
    const b = (await createCat("p6a1_并发恢复")).json.data! // 软删除让出名称 → 同名再建
    expect((await deleteCat(b.id)).status).toBe(200)

    const activeCount = async (): Promise<number> => {
      const rows = await rawQuery<{ n: number }>(
        env.pool,
        "SELECT COUNT(*) AS n FROM link_categories WHERE name = ? AND deleted_at IS NULL",
        ["p6a1_并发恢复"],
      )
      return Number(rows[0]!.n)
    }
    const call = (id: string, v: number) =>
      restoreRoute.POST(reqFor(su, "POST", `/api/admin/v1/categories/${id}/restore`, { version: v }), ctxOf(id))

    const [r1, r2] = await Promise.all([call(a.id, (await getCat(a.id)).data!.version), call(b.id, (await getCat(b.id)).data!.version)])
    for (const r of [r1, r2]) {
      // 绝不能出现 500：竞态失败也必须映射为业务 409（SQL 异常不透出）
      if (r.status !== 200) expect(r.status).toBe(409)
      if (r.status === 409) {
        const j = await body<never>(r)
        expect(["CATEGORY_NAME_CONFLICT", "VERSION_CONFLICT"]).toContain(j.error?.code)
      }
    }
    const wins = [r1, r2].filter((r) => r.status === 200).length
    expect(wins).toBeLessThanOrEqual(1) // 同名不可能双双成功（UNIQUE）
    expect(await activeCount()).toBe(wins)

    if (wins === 0) {
      // [409,409] 合法成因：死锁回滚后 InnoDB purge 延迟，幸存者仍见幽灵索引记录。
      // 模拟管理员再点一次 → 必有一条恢复成功，终态不变式仍成立
      const [r3, r4] = await Promise.all([call(a.id, (await getCat(a.id)).data!.version), call(b.id, (await getCat(b.id)).data!.version)])
      expect([r3.status, r4.status].filter((s) => s === 200).length).toBe(1)
    }
    expect(await activeCount()).toBe(1)
  })
})

async function getCatByNameWithDeleted(name: string): Promise<CategoryDto> {
  const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/categories?includeDeleted=true&q=${encodeURIComponent(name)}`))
  return (await body<PageResult<CategoryDto>>(res)).data!.items[0]!
}

describe("P6A 分类：审计（同事务 / 失败无审计 / 不含敏感数据）", () => {
  it("create 审计行：resource_type=link_category、actor 正确、after 含名称", async () => {
    const rows = await auditRows(env.pool, "category.create")
    const created = rows.filter((r) => r.resource_type === "link_category")
    expect(created.length).toBeGreaterThanOrEqual(10)
    const row = created.find((r) => auditJson(r.after_json)?.name === "p6a_一级A")!
    expect(String(row.actor_user_id)).toBe(String(su.admin.id))
    expect(row.before_json).toBeNull()
    expect(auditJson(row.after_json)).toMatchObject({ name: "p6a_一级A", parent_id: null, status: "active" })
    expect(row.request_id).toBeTruthy()
  })

  it("失败的乐观锁 update 不写审计（事务回滚证据）", async () => {
    const cur = (await getCat(C["p6a_一级B"].id)).data!
    const before = (await auditRows(env.pool, "category.update")).length
    const res = await itemRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/categories/${cur.id}`, { name: "p6a_冲突不回写", version: cur.version - 1 }),
      ctxOf(cur.id),
    )
    expect(res.status).toBe(409)
    const db = await rawQuery<{ name: string }>(
      env.pool,
      "SELECT name FROM link_categories WHERE id = ?",
      [cur.id],
    )
    expect(db[0]!.name).toBe("p6a_一级B改名")
    expect((await auditRows(env.pool, "category.update")).length).toBe(before)
  })

  it("update 审计记录 before/after 差异字段", async () => {
    const rows = await auditRows(env.pool, "category.update")
    const row = rows.find((r) => auditJson(r.after_json)?.name === "p6a_一级B改名")!
    expect(auditJson(row.before_json).name).not.toBe("p6a_一级B改名")
  })
})

describe("P6A 分类：RBAC 矩阵与 CSRF", () => {
  it("auditor：读 200；写（create/update/status/delete/restore/reorder）全部 403 FORBIDDEN", async () => {
    expect((await listRoute.GET(reqFor(auditor, "GET", "/api/admin/v1/categories"))).status).toBe(200)
    let res = await listRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/categories", { name: "p6a_auditor写" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("FORBIDDEN")
    const any = C["p6a_一级B"]
    res = await itemRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/categories/${any.id}`, { name: "auditor改名", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await statusRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/categories/${any.id}/status`, { status: "active", version: 999 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await itemRoute.DELETE(reqFor(auditor, "DELETE", `/api/admin/v1/categories/${any.id}?version=1`), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(auditor, "POST", `/api/admin/v1/categories/${any.id}/restore`, { version: 1 }), ctxOf(any.id))
    expect(res.status).toBe(403)
    res = await reorderRoute.PATCH(reqFor(auditor, "PATCH", "/api/admin/v1/categories/reorder", { parentId: null, items: [{ id: any.id, sortOrder: 1, version: 1 }] }))
    expect(res.status).toBe(403)
  })

  it("content_editor：read/create/update 200；delete 与 restore 403", async () => {
    const made = await createCat("p6a_editor_cat", { session: editor })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/categories/${id}`, { iconClass: "iconfont", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/categories/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(editor, "DELETE", `/api/admin/v1/categories/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(403)
    res = await restoreRoute.POST(reqFor(editor, "POST", `/api/admin/v1/categories/${id}/restore`, { version: 3 }), ctxOf(id))
    expect(res.status).toBe(403)
  })

  it("content_admin：全 CRUD 通过（create→update→disable→delete→restore）", async () => {
    const made = await createCat("p6a_cadmin_cat", { session: cadmin })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    let res = await itemRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/categories/${id}`, { name: "p6a_cadmin改名", version: 1 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await statusRoute.PATCH(reqFor(cadmin, "PATCH", `/api/admin/v1/categories/${id}/status`, { status: "disabled", version: 2 }), ctxOf(id))
    expect(res.status).toBe(200)
    res = await itemRoute.DELETE(reqFor(cadmin, "DELETE", `/api/admin/v1/categories/${id}?version=3`), ctxOf(id))
    expect(res.status).toBe(200)
    res = await restoreRoute.POST(reqFor(cadmin, "POST", `/api/admin/v1/categories/${id}/restore`, { version: 4 }), ctxOf(id))
    expect(res.status).toBe(200)
  })

  it("写请求缺 CSRF → 403 CSRF_INVALID；错 token 同样 403", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_无csrf" }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_错csrf" }, { csrfOverride: "bogus-token" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
  })

  it("写请求未认证 → 401（先于 CSRF/权限）", async () => {
    const res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name: "p6a_匿名" }, { noAuth: true }))
    expect(res.status).toBe(401)
    expect((await body<never>(res)).error?.code).toBe("UNAUTHORIZED")
  })

  it("错误信封不泄漏内部细节（无 stack/SQL）", async () => {
    const res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/categories?pageSize=30"))
    const text = await res.text()
    expect(text).not.toContain("SELECT")
    expect(text).not.toContain("at ")
    expect(JSON.parse(text).requestId).toBeTruthy()
  })
})
