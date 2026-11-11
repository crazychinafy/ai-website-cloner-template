// P6B §14.3 网址管理 API 全链路（scratch 库 facai8_p6b_test，真实 route handler 调用）
// - 新建合同：恒 draft / sourceSnapshot=false / AUTO_INCREMENT 十进制字符串 ID
// - 聚合：detail 服务端净化入库 + null 删除；mirrors 全量替换（顺序重排 / 归属校验）
// - 列表：分类/标签/状态/软删除过滤、q 三字段、排序白名单、categoryName/hasDetail/clickCount
// - 状态机矩阵（draft/published/disabled + 发布前置校验：分类停用 / 标签停用）
// - 软删除保留子表 + 恢复（分类被删 409 LINK_RESTORE_BLOCKED）；乐观锁 409；RBAC/CSRF；审计
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PageResult } from "../../src/lib/admin/dto/content.ts"
import type { LinkAggregateDto, LinkDto } from "../../src/lib/admin/dto/link.ts"
import {
  auditJson,
  auditRows,
  p6bLogin,
  rawQuery,
  reqFor,
  seedDetail,
  seedLinkRaw,
  seedMirror,
  setupP6bEnv,
  teardownP6bEnv,
  type P6bEnv,
  type P6bSession,
} from "./p6b-harness"

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

let env: P6bEnv
let su: P6bSession
let auditor: P6bSession
let editor: P6bSession
let cadmin: P6bSession

let listRoute: { GET: R1; POST: R1 }
let itemRoute: { GET: R2; PATCH: R2; DELETE: R2 }
let statusRoute: { PATCH: R2 }
let restoreRoute: { POST: R2 }
let catRoute: { GET: R1; POST: R1 }
let catStatusRoute: { PATCH: R2 }
let tagRoute: { GET: R1; POST: R1 }
let tagStatusRoute: { PATCH: R2 }

const CAT: Record<string, { id: string; version: number }> = {}
const TAG: Record<string, { id: string; version: number }> = {}

async function createLink(
  title: string,
  opts: { session?: P6bSession; extra?: Record<string, unknown> } = {},
): Promise<{ res: Response; json: Envelope<LinkAggregateDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", "/api/admin/v1/links", {
      title,
      url: "https://p6b.example/default",
      categoryId: CAT.catA.id,
      ...(opts.extra ?? {}),
    }),
  )
  return { res, json: await body<LinkAggregateDto>(res) }
}

async function getLink(id: string, session: P6bSession = su): Promise<Envelope<LinkAggregateDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `/api/admin/v1/links/${id}`), ctxOf(id)))
}

async function patchLink(
  id: string,
  payload: Record<string, unknown>,
  session: P6bSession = su,
): Promise<{ res: Response; json: Envelope<LinkAggregateDto> }> {
  const res = await itemRoute.PATCH(reqFor(session, "PATCH", `/api/admin/v1/links/${id}`, payload), ctxOf(id))
  return { res, json: await body<LinkAggregateDto>(res) }
}

async function patchStatus(
  id: string,
  status: string,
  version: number,
  session: P6bSession = su,
): Promise<{ res: Response; json: Envelope<LinkDto> }> {
  const res = await statusRoute.PATCH(reqFor(session, "PATCH", `/api/admin/v1/links/${id}/status`, { status, version }), ctxOf(id))
  return { res, json: await body<LinkDto>(res) }
}

async function deleteLink(id: string, version: number, session: P6bSession = su): Promise<Response> {
  return itemRoute.DELETE(reqFor(session, "DELETE", `/api/admin/v1/links/${id}?version=${version}`, undefined), ctxOf(id))
}

async function restoreLink(id: string, version: number, session: P6bSession = su): Promise<Response> {
  return restoreRoute.POST(reqFor(session, "POST", `/api/admin/v1/links/${id}/restore`, { version }), ctxOf(id))
}

/** 列表里找行（默认视图） */
async function findLink(qs: string, id: string): Promise<LinkDto | undefined> {
  const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/links?pageSize=100&${qs}`))
  return (await body<PageResult<LinkDto>>(res)).data!.items.find((i) => i.id === id)
}

beforeAll(async () => {
  env = await setupP6bEnv()
  listRoute = await import("../../src/app/api/admin/v1/links/route")
  itemRoute = await import("../../src/app/api/admin/v1/links/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/links/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/links/[id]/restore/route")
  catRoute = await import("../../src/app/api/admin/v1/categories/route")
  catStatusRoute = await import("../../src/app/api/admin/v1/categories/[id]/status/route")
  tagRoute = await import("../../src/app/api/admin/v1/tags/route")
  tagStatusRoute = await import("../../src/app/api/admin/v1/tags/[id]/status/route")
  su = await p6bLogin(env, "p6b_link_super", ["super_admin"])
  auditor = await p6bLogin(env, "p6b_link_auditor", ["auditor"])
  editor = await p6bLogin(env, "p6b_link_editor", ["content_editor"])
  cadmin = await p6bLogin(env, "p6b_link_cadmin", ["content_admin"])

  for (const name of ["p6b_分类A", "p6b_分类B"]) {
    const res = await catRoute.POST(reqFor(su, "POST", "/api/admin/v1/categories", { name }))
    expect(res.status).toBe(200)
    const d = (await body<{ id: string; version: number }>(res)).data!
    CAT[name === "p6b_分类A" ? "catA" : "catB"] = { id: d.id, version: d.version }
  }
  for (const name of ["p6b_标签T1", "p6b_标签T2"]) {
    const res = await tagRoute.POST(reqFor(su, "POST", "/api/admin/v1/tags", { name }))
    expect(res.status).toBe(200)
    const d = (await body<{ id: string; version: number }>(res)).data!
    TAG[name === "p6b_标签T1" ? "tag1" : "tag2"] = { id: d.id, version: d.version }
  }
}, 240_000)

afterAll(async () => {
  await teardownP6bEnv(env)
})

// ─────────────────────────────────────────────────────────────────

describe("P6B 网址：新建", () => {
  it("POST → 200：恒 draft / sourceSnapshot=false / AUTO_INCREMENT 十进制字符串 id / version=1", async () => {
    const { res, json } = await createLink("p6b_网址_正规", { extra: { status: "published", isGone: true } })
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9][0-9]*$/)
    expect(typeof d.id).toBe("string")
    expect(d.status).toBe("draft") // 客户端 status 被剥离
    expect(d.isGone).toBe(false)
    expect(d.sourceSnapshot).toBe(false)
    expect(d.version).toBe(1)
    expect(d.deletedAt).toBeNull()
    expect(d.categoryId).toBe(CAT.catA.id)
    expect(d.categoryName).toBe("p6b_分类A")
    expect(d.tagId).toBeNull()
    expect(d.clickCount).toBe(0)
    expect(d.hasDetail).toBe(false)
    expect(d.detail).toBeNull()
    expect(d.mirrors).toEqual([])
  })

  it("POST 聚合：detail 服务端净化入库；mirrors 按数组序重排 sortOrder", async () => {
    const { res, json } = await createLink("p6b_网址_聚合创建", {
      extra: {
        tagId: TAG.tag1.id,
        description: "p6b_desc_zh",
        logoPath: "/uploads/p6b/logo.webp",
        detail: {
          annotation: "标注",
          previewImage: "/uploads/p6b/prev.webp",
          detailHtml: '<p onclick="x">保留</p><script>alert(1)</script><a href="javascript:alert(2)">链</a>',
          clickCount: 12,
          likeCount: 3,
        },
        mirrors: [
          { name: "备用一", url: "https://m1.example" },
          { name: "备用二", url: "https://m2.example" },
        ],
      },
    })
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.tagName).toBe("p6b_标签T1")
    expect(d.hasDetail).toBe(true)
    expect(d.clickCount).toBe(12)
    expect(d.detail!.detailHtml).toBe("<p>保留</p><a>链</a>") // script 删除、事件属性剥离、js href 剥离
    expect(d.detail!.annotation).toBe("标注")
    expect(d.detail!.clickCount).toBe(12)
    expect(d.mirrors.map((m) => m.sortOrder)).toEqual([0, 1])
    // 库里存的也是净化后的
    const raw = await rawQuery<{ detail_html: string }>(env.pool, "SELECT detail_html FROM site_link_details WHERE link_id = ?", [d.id])
    expect(raw[0]!.detail_html).toBe("<p>保留</p><a>链</a>")
  })

  it("校验 422：缺 title/url/categoryId；url scheme 非法；categoryId 格式；logoPath 协议相对", async () => {
    for (const payload of [
      { url: "https://p6b.example/x", categoryId: CAT.catA.id },
      { title: "t", categoryId: CAT.catA.id },
      { title: "t", url: "https://p6b.example/x" },
      { title: "t", url: "javascript:alert(1)", categoryId: CAT.catA.id },
      { title: "t", url: "ftp://p6b.example", categoryId: CAT.catA.id },
      { title: "t", url: "https://p6b.example/x", categoryId: "not-a-bigint" },
      { title: "t", url: "https://p6b.example/x", categoryId: CAT.catA.id, logoPath: "//cdn.example/x" },
    ]) {
      const res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/links", payload))
      expect(res.status, JSON.stringify(payload)).toBe(422)
    }
  })

  it("引用校验：分类不存在/标签不存在 → 409；停用分类/标签允许关联（发布才拦）", async () => {
    let res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/links", { title: "p6b_网址_幽灵分类", url: "https://p6b.example/g", categoryId: "9900000000000000099" }),
    )
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VALIDATION_ERROR")

    res = await listRoute.POST(
      reqFor(su, "POST", "/api/admin/v1/links", { title: "p6b_网址_幽灵标签", url: "https://p6b.example/g", categoryId: CAT.catA.id, tagId: "9900000000000000098" }),
    )
    expect(res.status).toBe(409)

    // 停用标签 T2 后关联它 → 仍然 200（关联 ≠ 发布）
    const dis = await tagStatusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/tags/${TAG.tag2.id}/status`, { status: "disabled", version: TAG.tag2.version }), ctxOf(TAG.tag2.id))
    expect(dis.status).toBe(200)
    TAG.tag2.version = (await body<{ version: number }>(dis)).data!.version
    const made = await createLink("p6b_网址_停用标签", { extra: { tagId: TAG.tag2.id } })
    expect(made.res.status).toBe(200)
  })

  it("sortOrder 省略时 = 全局最大 +1；显式值原样生效", async () => {
    const a = (await createLink("p6b_网址_排序1")).json.data!
    const b = (await createLink("p6b_网址_排序2")).json.data!
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)
    const c = (await createLink("p6b_网址_排序显式", { extra: { sortOrder: 777 } })).json.data!
    expect(c.sortOrder).toBe(777)
  })
})

describe("P6B 网址：读取与列表", () => {
  let inCatB: LinkAggregateDto
  let tagged: LinkAggregateDto
  let softDeleted: LinkAggregateDto

  beforeAll(async () => {
    inCatB = (await createLink("p6b_列表_分类B", { extra: { categoryId: CAT.catB.id, url: "https://qurlz7.example/path" } })).json.data!
    tagged = (await createLink("p6b_列表_带标签", { extra: { tagId: TAG.tag1.id } })).json.data!
    for (const t of ["p6b_sort_b", "p6b_sort_a", "p6b_sort_c"]) {
      expect((await createLink(t)).res.status).toBe(200)
    }
    const del = (await createLink("p6b_列表_将删")).json.data!
    expect((await deleteLink(del.id, del.version)).status).toBe(200)
    softDeleted = del
  })

  it("GET 单条聚合：detail/mirrors 齐全；非法 id → 422；不存在 → 404 LINK_NOT_FOUND", async () => {
    const j = await getLink(inCatB.id)
    expect(j.data!.categoryId).toBe(CAT.catB.id)
    let res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/links/abc"), ctxOf("abc"))
    expect(res.status).toBe(422)
    res = await itemRoute.GET(reqFor(su, "GET", "/api/admin/v1/links/9900000000000000077"), ctxOf("9900000000000000077"))
    expect(res.status).toBe(404)
    expect((await body<never>(res)).error?.code).toBe("LINK_NOT_FOUND")
  })

  it("categoryId / tagId / status 过滤", async () => {
    const byCat = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/links?pageSize=100&categoryId=${CAT.catB.id}`)))
    expect(byCat.data!.items.length).toBeGreaterThan(0)
    expect(byCat.data!.items.every((i) => i.categoryId === CAT.catB.id)).toBe(true)
    expect(byCat.data!.items.some((i) => i.id === inCatB.id)).toBe(true)

    const byTag = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/links?pageSize=100&tagId=${TAG.tag1.id}`)))
    expect(byTag.data!.items.every((i) => i.tagId === TAG.tag1.id)).toBe(true)
    expect(byTag.data!.items.map((i) => i.id)).toContain(tagged.id)

    const drafts = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?pageSize=100&status=draft")))
    expect(drafts.data!.items.every((i) => i.status === "draft")).toBe(true)
    const published = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?pageSize=100&status=published")))
    expect(published.data!.items.every((i) => i.status === "published")).toBe(true)
  })

  it("q 命中标题 / 地址 / 简介三字段", async () => {
    const byTitle = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?q=" + encodeURIComponent("列表_带标签"))))
    expect(byTitle.data!.items.map((i) => i.id)).toEqual([tagged.id])
    const byUrl = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?q=qurlz7")))
    expect(byUrl.data!.items.map((i) => i.id)).toContain(inCatB.id)
    const byDesc = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?q=p6b_desc_zh")))
    expect(byDesc.data!.items.length).toBe(1) // 「聚合创建」的 description
  })

  it("默认视图隐藏软删除行；includeDeleted=true 可见（deletedAt 非空）", async () => {
    expect(await findLink("", softDeleted.id)).toBeUndefined()
    const row = await findLink("includeDeleted=true", softDeleted.id)
    expect(row).toBeTruthy()
    expect(row!.deletedAt).toBeTruthy()
  })

  it("排序：sortBy=title asc/desc（ASCII 标题）；非法 sortBy → 422", async () => {
    const asc = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?pageSize=100&q=p6b_sort_&sortBy=title")))
    const titles = asc.data!.items.map((i) => i.title)
    expect(titles).toEqual(["p6b_sort_a", "p6b_sort_b", "p6b_sort_c"]) // beforeAll 顺序保证存在
    const descRes = await body<PageResult<LinkDto>>(await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?pageSize=100&q=p6b_sort_&sortBy=title&sortDir=desc")))
    expect(descRes.data!.items.map((i) => i.title)).toEqual(["p6b_sort_c", "p6b_sort_b", "p6b_sort_a"])
    const res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links?sortBy=clickCount"))
    expect(res.status).toBe(422)
  })

  it("列表附带 clickCount / hasDetail（详情行缺失时 0/false）", async () => {
    const withDetail = (await createLink("p6b_列表_有详情")).json.data!
    await seedDetail(env.db, withDetail.id, { clickCount: 4242 })
    const row = await findLink("q=p6b_列表_有详情", withDetail.id)
    expect(row!.clickCount).toBe(4242)
    expect(row!.hasDetail).toBe(true)
    const plain = await findLink("", tagged.id)
    expect(plain!.clickCount).toBe(0)
    expect(plain!.hasDetail).toBe(false)
  })

  it("非法查询参数 → 422", async () => {
    for (const qs of ["pageSize=30", "page=0", "sortDir=up", "status=pending", "categoryId=1e5", "includeDeleted=yes"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `/api/admin/v1/links?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })
})

// 排序夹具在「读取与列表」beforeAll 内创建（p6b_sort_a/b/c）

describe("P6B 网址：聚合编辑（PATCH）", () => {
  it("主字段编辑 → 200 / version+1；stale version → 409 VERSION_CONFLICT（原样文案）", async () => {
    const made = (await createLink("p6b_编辑_主字段")).json.data!
    const { res, json } = await patchLink(made.id, { title: "p6b_编辑_改名", url: "https://p6b.example/renamed", version: made.version })
    expect(res.status).toBe(200)
    expect(json.data!.title).toBe("p6b_编辑_改名")
    expect(json.data!.version).toBe(made.version + 1)

    const stale = await patchLink(made.id, { title: "p6b_编辑_冲突", version: made.version })
    expect(stale.res.status).toBe(409)
    expect(stale.json.error?.code).toBe("VERSION_CONFLICT")
    expect(stale.json.error?.message).toBe(VERSION_CONFLICT_MSG)
  })

  it("status/isGone 不在 PATCH 合同：提交 status 被剥离（普通编辑改不了状态）", async () => {
    const made = (await createLink("p6b_编辑_剥离状态")).json.data!
    const { res, json } = await patchLink(made.id, { title: "p6b_编辑_剥离状态2", status: "published", version: made.version })
    expect(res.status).toBe(200)
    expect(json.data!.status).toBe("draft")
  })

  it("空 patch（只有 version）→ 422；detail/mirrors 单独提交算有效 patch", async () => {
    const made = (await createLink("p6b_编辑_空patch")).json.data!
    const empty = await patchLink(made.id, { version: made.version })
    expect(empty.res.status).toBe(422)
    expect(empty.json.error?.code).toBe("VALIDATION_ERROR")
    const j = (await patchLink(made.id, { detail: { annotation: "只改标注" }, version: made.version })).json
    expect(j.data!.detail!.annotation).toBe("只改标注")
    expect(j.data!.version).toBe(made.version + 1) // 只动子表也 bump 主行 version
  })

  it("detail upsert 部分字段（不覆盖 clickCount）；detail=null 删除详情行", async () => {
    const made = (await createLink("p6b_编辑_详情", { extra: { detail: { annotation: "a", clickCount: 9 } } })).json.data!
    let d = (await patchLink(made.id, { detail: { detailHtml: "<b>x</b><script>kill()</script>", annotation: "b" }, version: made.version })).json.data!
    expect(d.detail!.annotation).toBe("b")
    expect(d.detail!.clickCount).toBe(9) // 未提交的字段保留
    expect(d.detail!.detailHtml).toBe("<b>x</b>")

    d = (await patchLink(made.id, { detail: null, version: d.version })).json.data!
    expect(d.detail).toBeNull()
    expect(d.hasDetail).toBe(false)
    expect(d.clickCount).toBe(0)
    const raw = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM site_link_details WHERE link_id = ?", [made.id])
    expect(Number(raw[0]!.n)).toBe(0)
  })

  it("mirrors 全量替换：保留 ID 更新 + 新条目插入 + 未提交者删除；顺序重排 0..n-1", async () => {
    const made = (await createLink("p6b_编辑_备用", {
      extra: { mirrors: [{ name: "旧一", url: "https://old1.example" }, { name: "旧二", url: "https://old2.example" }, { name: "旧三", url: "https://old3.example" }] },
    })).json.data!
    const [m1, m2, m3] = made.mirrors.map((m) => m.id)
    const d = (await patchLink(made.id, {
      mirrors: [
        { id: m2, name: "旧二改名", url: "https://old2b.example" },
        { name: "全新", url: "https://fresh.example" },
      ],
      version: made.version,
    })).json.data!
    expect(d.mirrors.map((m) => m.name)).toEqual(["旧二改名", "全新"])
    expect(d.mirrors[0]!.id).toBe(m2) // 保留的 ID 原样更新
    const kept = new Set([m1, m2, m3])
    expect(kept.has(d.mirrors[1]!.id)).toBe(false) // 新行新 ID
    expect(d.mirrors.map((m) => m.sortOrder)).toEqual([0, 1])
    const raw = await rawQuery<{ ids: string }>(env.pool, "SELECT GROUP_CONCAT(id ORDER BY id) AS ids FROM site_link_mirrors WHERE link_id = ?", [made.id])
    expect(raw[0]!.ids!.split(",")).toHaveLength(2) // m1、m3 已物理删除
  })

  it("mirrors 归属校验：他网 URL ID → 409 LINK_MIRROR_MISMATCH；重复 ID → 422；空数组清空", async () => {
    const a = (await createLink("p6b_备用_A", { extra: { mirrors: [{ name: "A的备用", url: "https://a-mirror.example" }] } })).json.data!
    const b = (await createLink("p6b_备用_B")).json.data!
    const foreign = a.mirrors[0]!.id

    const foreignFail = await patchLink(b.id, { mirrors: [{ id: foreign, name: "x", url: "https://x.example" }], version: b.version })
    expect(foreignFail.res.status).toBe(409)
    expect(foreignFail.json.error?.code).toBe("LINK_MIRROR_MISMATCH")

    const dup = await patchLink(b.id, { mirrors: [{ id: "101", name: "p", url: "https://p.example" }, { id: "101", name: "q", url: "https://q.example" }], version: b.version })
    expect(dup.res.status).toBe(422) // schema 层去重

    const empty = (await patchLink(a.id, { mirrors: [], version: a.version })).json.data!
    expect(empty.mirrors).toEqual([])
  })

  it("改 categoryId/tagId：幽灵分类 409；tagId=null 移除标签；软删除行 PATCH → 404", async () => {
    const made = (await createLink("p6b_编辑_归属", { extra: { tagId: TAG.tag1.id } })).json.data!
    const ghost = await patchLink(made.id, { categoryId: "9900000000000000076", version: made.version })
    expect(ghost.res.status).toBe(409)
    const d = (await patchLink(made.id, { tagId: null, version: made.version })).json.data!
    expect(d.tagId).toBeNull()

    const del = (await createLink("p6b_编辑_已删")).json.data!
    expect((await deleteLink(del.id, del.version)).status).toBe(200)
    const gone = await patchLink(del.id, { title: "改名", version: del.version })
    expect(gone.res.status).toBe(404)
    expect(gone.json.error?.code).toBe("LINK_NOT_FOUND")
  })

  it("detailHtml 净化也在 PATCH 生效（onerror 事件属性剥离）", async () => {
    const made = (await createLink("p6b_编辑_XSS")).json.data!
    const d = (await patchLink(made.id, { detail: { detailHtml: '<img src="/u.png" onerror="alert(1)">' }, version: made.version })).json.data!
    expect(d.detail!.detailHtml).toBe('<img src="/u.png">')
  })
})

describe("P6B 网址：状态机（PATCH /status，links.publish）", () => {
  it("矩阵：draft→published→disabled→published、published→draft、draft→disabled 全部 200；非法/同态 422", async () => {
    const l = (await createLink("p6b_状态_矩阵")).json.data!
    let v = l.version
    let r = await patchStatus(l.id, "published", v)
    expect(r.res.status).toBe(200)
    expect(r.json.data!.status).toBe("published")
    expect(r.json.data!.version).toBe(v + 1)
    v = r.json.data!.version

    // 同状态 → 422
    r = await patchStatus(l.id, "published", v)
    expect(r.res.status).toBe(422)
    expect(r.json.error?.code).toBe("LINK_STATUS_TRANSITION")

    r = await patchStatus(l.id, "disabled", v)
    expect(r.res.status).toBe(200)
    v = r.json.data!.version

    // disabled→draft 禁止（要回草稿先发布再撤回）
    r = await patchStatus(l.id, "draft", v)
    expect(r.res.status).toBe(422)
    expect(r.json.error?.code).toBe("LINK_STATUS_TRANSITION")

    r = await patchStatus(l.id, "published", v) // disabled→published 快捷发布
    expect(r.res.status).toBe(200)
    v = r.json.data!.version

    r = await patchStatus(l.id, "draft", v) // published→draft 下架回草稿
    expect(r.res.status).toBe(200)
    expect(r.json.data!.status).toBe("draft")
    v = r.json.data!.version

    r = await patchStatus(l.id, "disabled", v) // 草稿也可直接停用
    expect(r.res.status).toBe(200)
    v = r.json.data!.version

    // 恢复可用状态给后续
    r = await patchStatus(l.id, "published", v)
    expect(r.res.status).toBe(200)
  })

  it("状态端点 version 冲突 → 409；软删除行状态操作 → 404", async () => {
    const l = (await createLink("p6b_状态_version")).json.data!
    const r = await patchStatus(l.id, "published", 999)
    expect(r.res.status).toBe(409)
    expect(r.json.error?.code).toBe("VERSION_CONFLICT")

    expect((await deleteLink(l.id, l.version)).status).toBe(200)
    const r2 = await patchStatus(l.id, "published", l.version)
    expect(r2.res.status).toBe(404)
  })

  it("发布前置：分类停用 → 409「停用状态」；重新启用后发布 200", async () => {
    const l = (await createLink("p6b_状态_停用分类", { extra: { categoryId: CAT.catB.id } })).json.data!
    let res = await catStatusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${CAT.catB.id}/status`, { status: "disabled", version: CAT.catB.version }), ctxOf(CAT.catB.id))
    expect(res.status).toBe(200)
    CAT.catB.version = (await body<{ version: number }>(res)).data!.version

    const blocked = await patchStatus(l.id, "published", l.version)
    expect(blocked.res.status).toBe(409)
    expect(blocked.json.error?.code).toBe("VALIDATION_ERROR")
    expect(blocked.json.error?.message).toContain("停用状态")

    res = await catStatusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/categories/${CAT.catB.id}/status`, { status: "active", version: CAT.catB.version }), ctxOf(CAT.catB.id))
    CAT.catB.version = (await body<{ version: number }>(res)).data!.version
    const ok = await patchStatus(l.id, "published", l.version)
    expect(ok.res.status).toBe(200)
  })

  it("发布前置：标签停用 → 409 TAG_NOT_USABLE；启用标签后发布 200", async () => {
    const l = (await createLink("p6b_状态_停用标签", { extra: { tagId: TAG.tag2.id } })).json.data!
    const blocked = await patchStatus(l.id, "published", l.version)
    expect(blocked.res.status).toBe(409)
    expect(blocked.json.error?.code).toBe("TAG_NOT_USABLE")

    const res = await tagStatusRoute.PATCH(reqFor(su, "PATCH", `/api/admin/v1/tags/${TAG.tag2.id}/status`, { status: "active", version: TAG.tag2.version }), ctxOf(TAG.tag2.id))
    TAG.tag2.version = (await body<{ version: number }>(res)).data!.version
    const ok = await patchStatus(l.id, "published", l.version)
    expect(ok.res.status).toBe(200)
    expect(ok.json.data!.status).toBe("published")
  })

  it("状态 DTO 是主行（无 detail/mirrors 键）；categoryName 仍带出", async () => {
    const l = (await createLink("p6b_状态_DTO", { extra: { detail: { annotation: "d" } } })).json.data!
    const r = await patchStatus(l.id, "published", l.version)
    expect(r.json.data!.categoryName).toBe("p6b_分类A")
    expect("detail" in r.json.data!).toBe(false)
    expect("mirrors" in r.json.data!).toBe(false)
  })
})

describe("P6B 网址：软删除与恢复", () => {
  it("DELETE ?version → 200 LinkDto（deletedAt 非空）；默认列表隐藏；软删除行仍可按 ID 读取（恢复需要 version）", async () => {
    const l = (await createLink("p6b_删除_基本", { extra: { detail: { annotation: "留档" }, mirrors: [{ name: "留", url: "https://keep.example" }] } })).json.data!
    const res = await deleteLink(l.id, l.version)
    expect(res.status).toBe(200)
    const j = await body<LinkDto>(res)
    expect(j.data!.id).toBe(l.id)
    expect(j.data!.deletedAt).toBeTruthy()

    expect(await findLink("", l.id)).toBeUndefined()
    const row = await findLink("includeDeleted=true", l.id)
    expect(row!.deletedAt).toBeTruthy()

    // 按 ID 仍可读（回收站表单）
    const got = await getLink(l.id)
    expect(got.data!.detail!.annotation).toBe("留档") // 子表保留
    expect(got.data!.mirrors).toHaveLength(1)
    // 再删 → 404；version 不对也 404（软删除行 update/delete 语义）
    expect((await deleteLink(l.id, l.version)).status).toBe(404)
    // 恢复（状态保留 draft）
    const rr = await restoreLink(l.id, got.data!.version)
    expect(rr.status).toBe(200)
    const restored = (await body<LinkDto>(rr)).data!
    expect(restored.deletedAt).toBeNull()
    expect(restored.status).toBe("draft")
    expect(restored.version).toBe(got.data!.version + 1)
    expect((await findLink("", l.id))!.id).toBe(l.id)
  })

  it("DELETE version 冲突 → 409 VERSION_CONFLICT；未删除行 restore → 422", async () => {
    const l = (await createLink("p6b_删除_version")).json.data!
    let res = await deleteLink(l.id, 12345)
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("VERSION_CONFLICT")

    res = await restoreLink(l.id, l.version)
    expect(res.status).toBe(422)
    expect((await body<never>(res)).error?.code).toBe("VALIDATION_ERROR")
  })

  it("恢复 409 LINK_RESTORE_BLOCKED：分类被删后恢复网址被阻断；软删除行 PATCH 修归属也 404", async () => {
    // 绕过分类保护的孤儿场景（模拟导入事故）：raw 建一级分类 → 直插网址 → 软删除 → raw 软删除分类
    await rawQuery(
      env.pool,
      "INSERT INTO link_categories (id, name) VALUES (9900000000000000061, 'p6b_分类_回收')",
    )
    const l = await seedLinkRaw(env.db, { categoryId: "9900000000000000061", title: "p6b_删除_孤儿恢复", status: "draft" })
    const delVer = (await getLink(l)).data!.version
    expect((await deleteLink(l, delVer)).status).toBe(200)

    await env.pool.query("UPDATE link_categories SET deleted_at = '2026-01-01 00:00:00.000' WHERE id = ?", ["9900000000000000061"])
    const cur = (await getLink(l)).data!
    let res = await restoreLink(l, cur.version)
    expect(res.status).toBe(409)
    expect((await body<never>(res)).error?.code).toBe("LINK_RESTORE_BLOCKED")

    // 软删除行也不能 PATCH 修归属（404）——先恢复才是正门
    res = (await patchLink(l, { categoryId: CAT.catA.id, version: cur.version })).res
    expect(res.status).toBe(404)
  })

  it("软删除期间 AUTO_INCREMENT 继续：新建网址 ID 递增不冲突", async () => {
    const a = (await createLink("p6b_删除_新建1")).json.data!
    expect((await deleteLink(a.id, a.version)).status).toBe(200)
    const b = (await createLink("p6b_删除_新建2")).json.data!
    expect(BigInt(b.id) > BigInt(a.id)).toBe(true)
  })

  it("mirror 直插后软删除父行：mirror 行保留（物理）", async () => {
    const l = await seedLinkRaw(env.db, { categoryId: CAT.catA.id, title: "p6b_删除_mirror保留", status: "draft" })
    const mid = await seedMirror(env.db, l, "直插备用", "https://direct.example")
    const v = (await getLink(l)).data!.version
    expect((await deleteLink(l, v)).status).toBe(200)
    const rows = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM site_link_mirrors WHERE id = ?", [mid])
    expect(Number(rows[0]!.n)).toBe(1)
  })
})

describe("P6B 网址：RBAC 与 CSRF", () => {
  it("auditor：读 200；create/update/status/delete/restore 全部 403", async () => {
    const target = (await createLink("p6b_RBAC_审计员目标")).json.data!
    let res = await listRoute.GET(reqFor(auditor, "GET", "/api/admin/v1/links"))
    expect(res.status).toBe(200)
    res = await itemRoute.GET(reqFor(auditor, "GET", `/api/admin/v1/links/${target.id}`), ctxOf(target.id))
    expect(res.status).toBe(200)

    res = await listRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/links", { title: "x", url: "https://x.example", categoryId: CAT.catA.id }))
    expect(res.status).toBe(403)
    const upd = await itemRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/links/${target.id}`, { title: "y", version: target.version }), ctxOf(target.id))
    expect(upd.status).toBe(403)
    res = await statusRoute.PATCH(reqFor(auditor, "PATCH", `/api/admin/v1/links/${target.id}/status`, { status: "published", version: target.version }), ctxOf(target.id))
    expect(res.status).toBe(403)
    res = await deleteLink(target.id, target.version, auditor)
    expect(res.status).toBe(403)
    res = await restoreLink(target.id, target.version, auditor)
    expect(res.status).toBe(403)
  })

  it("content_editor：读/新建/编辑 200；status（links.publish）与 delete/restore 403", async () => {
    const made = await createLink("p6b_RBAC_编辑员新建", { session: editor })
    expect(made.res.status).toBe(200)
    const upd = await patchLink(made.json.data!.id, { title: "p6b_RBAC_编辑员改名", version: made.json.data!.version }, editor)
    expect(upd.res.status).toBe(200)

    let res = await statusRoute.PATCH(reqFor(editor, "PATCH", `/api/admin/v1/links/${made.json.data!.id}/status`, { status: "published", version: upd.json.data!.version }), ctxOf(made.json.data!.id))
    expect(res.status).toBe(403)
    res = await deleteLink(made.json.data!.id, upd.json.data!.version, editor)
    expect(res.status).toBe(403)
    res = await restoreLink(made.json.data!.id, upd.json.data!.version, editor)
    expect(res.status).toBe(403)
  })

  it("content_admin：status + delete + restore 全通（links.publish/links.delete 都有）", async () => {
    const made = (await createLink("p6b_RBAC_内容管理员")).json.data!
    const r = await patchStatus(made.id, "published", made.version, cadmin)
    expect(r.res.status).toBe(200)
    const del = await deleteLink(made.id, r.json.data!.version, cadmin)
    expect(del.status).toBe(200)
    const got = (await getLink(made.id, cadmin)).data!
    const rr = await restoreLink(made.id, got.version, cadmin)
    expect(rr.status).toBe(200)
    expect((await body<LinkDto>(rr)).data!.deletedAt).toBeNull()
  })

  it("写请求缺 CSRF / 错 token → 403 CSRF_INVALID；未认证 → 401", async () => {
    let res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/links", { title: "p6b_CSRF_无", url: "https://c.example", categoryId: CAT.catA.id }, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/links", { title: "p6b_CSRF_错", url: "https://c.example", categoryId: CAT.catA.id }, { csrfOverride: "bogus" }))
    expect(res.status).toBe(403)
    expect((await body<never>(res)).error?.code).toBe("CSRF_INVALID")
    res = await listRoute.POST(reqFor(su, "POST", "/api/admin/v1/links", { title: "p6b_CSRF_匿名", url: "https://c.example", categoryId: CAT.catA.id }, { noAuth: true }))
    expect(res.status).toBe(401)
    res = await listRoute.GET(reqFor(su, "GET", "/api/admin/v1/links", undefined, { noAuth: true }))
    expect(res.status).toBe(401)
  })

  it("方法不允许 → 405 信封", async () => {
    const route = await import("../../src/app/api/admin/v1/links/[id]/restore/route") as { GET: R2 }
    const res = await route.GET(reqFor(su, "GET", "/api/admin/v1/links/1/restore"), ctxOf("1"))
    expect(res.status).toBe(405)
  })
})

describe("P6B 网址：审计", () => {
  it("create 审计：resource_type=link / actor 正确 / after 含 title/url/status=draft", async () => {
    const made = (await createLink("p6b_审计_新建", { extra: { description: "审计描述" } })).json.data!
    const rows = await auditRows(env.pool, "link.create")
    const row = rows.find((r) => r.resource_id === made.id)!
    expect(row).toBeTruthy()
    expect(row.resource_type).toBe("link")
    expect(String(row.actor_user_id)).toBe(String(su.admin.id))
    expect(row.before_json).toBeNull()
    const after = auditJson(row.after_json)
    expect(after.title).toBe("p6b_审计_新建")
    expect(after.status).toBe("draft")
    expect(row.request_id).toBeTruthy()
  })

  it("update 审计 before/after diff 精确；详情只记字段名（不存 HTML 正文）", async () => {
    const made = (await createLink("p6b_审计_编辑")).json.data!
    await patchLink(made.id, { title: "p6b_审计_编辑后", detail: { detailHtml: "<p>很长的正文用于验证不落库</p>".repeat(5) }, version: made.version })
    const rows = await auditRows(env.pool, "link.update")
    const row = rows.find((r) => r.resource_id === made.id)!
    const before = auditJson(row.before_json)
    const after = auditJson(row.after_json)
    expect(before.title).toBe("p6b_审计_编辑")
    expect(after.title).toBe("p6b_审计_编辑后")
    expect(after.detail).toEqual({ fields: ["detailHtml"] })
    expect(JSON.stringify(row.after_json)).not.toContain("很长的正文")
  })

  it("状态审计 action 区分 publish/disable/unpublish，before.status/after.status 成对", async () => {
    const l = (await createLink("p6b_审计_状态")).json.data!
    const r1 = await patchStatus(l.id, "published", l.version)
    const r2 = await patchStatus(l.id, "disabled", r1.json.data!.version)
    const r3 = await patchStatus(l.id, "published", r2.json.data!.version)
    expect(r3.json.data!.status).toBe("published")
    const expectAfter: Record<string, string> = { "link.publish": "published", "link.disable": "disabled" }
    for (const action of ["link.publish", "link.disable"]) {
      const rows = await auditRows(env.pool, action)
      const row = rows.find((x) => x.resource_id === l.id)!
      expect(row).toBeTruthy()
      expect(auditJson(row.before_json).status).toBeTruthy()
      expect(auditJson(row.after_json).status).toBe(expectAfter[action])
    }
    const pubRows = await auditRows(env.pool, "link.publish")
    expect(pubRows.filter((x) => x.resource_id === l.id)).toHaveLength(2)
  })

  it("软删除/恢复审计 deleted_at 前后成对；resource_type=link", async () => {
    const l = (await createLink("p6b_审计_删恢")).json.data!
    expect((await deleteLink(l.id, l.version)).status).toBe(200)
    const got = (await getLink(l.id)).data!
    expect((await restoreLink(l.id, got.version)).status).toBe(200)

    const del = (await auditRows(env.pool, "link.soft_delete")).find((r) => r.resource_id === l.id)!
    expect(auditJson(del.before_json).deleted_at).toBeNull()
    expect(auditJson(del.after_json).deleted_at).toBeTruthy()
    const rst = (await auditRows(env.pool, "link.restore")).find((r) => r.resource_id === l.id)!
    expect(auditJson(rst.before_json).deleted_at).toBeTruthy()
    expect(auditJson(rst.after_json).deleted_at).toBeNull()
  })

  it("回滚不留审计：409 冲突的写请求不产生 audit 行", async () => {
    const l = (await createLink("p6b_审计_回滚")).json.data!
    const { res } = await patchLink(l.id, { title: "冲突", version: 98765 })
    expect(res.status).toBe(409)
    const rows = await auditRows(env.pool, "link.update")
    expect(rows.find((r) => r.resource_id === l.id)).toBeUndefined()
  })
})
