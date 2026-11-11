// P6C §14 文章管理 API 全链路（scratch 库 facai8_p6c_test，真实 route handler 调用）
// - 新建合同：恒 draft / authorName=管理员 displayName / categoryName 快照 / AUTO_INCREMENT 十进制字符串 ID
// - 正文服务端净化（create/update/publish 触点）；受保护字段 strictObject 422
// - 状态机矩阵（published→draft 撤回禁止）+ 发布闸门（分类启用 / 正文非空 / 历史正文收敛）
// - publishedAt 首发写一次（归档/再发布/编辑不覆盖）；软删除保留状态 + 恢复（分类删除 409 阻断）
// - 预览：净化回显、不落库不审计、编辑权限门；预览大 body 422；乐观锁 409；RBAC/CSRF；审计；事务回滚
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import type { ArticleDto, PageResult } from "../../src/lib/admin/dto/article.ts"
import { sanitizeRichHtml } from "../../src/lib/admin/security/html-sanitizer.ts"
import {
  auditJson,
  auditRows,
  countAudit,
  errBody,
  expectedAuthorName,
  p6cLogin,
  rawQuery,
  reqFor,
  seedArticleRaw,
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
let previewRoute: { POST: R1; GET: R1 }
let catRoute: { GET: R1; POST: R1 }
let catItemRoute: { GET: R2; DELETE: R2 }
let catStatusRoute: { PATCH: R2 }

const CAT: Record<string, { id: string; name: string }> = {}

const BASE = "/api/admin/v1/articles"

async function createArticle(
  title: string,
  opts: { session?: P6cSession; categoryId?: string; extra?: Record<string, unknown> } = {},
): Promise<{ res: Response; json: Envelope<ArticleDto> }> {
  const res = await listRoute.POST(
    reqFor(opts.session ?? su, "POST", BASE, {
      title,
      categoryId: opts.categoryId ?? CAT.catA.id,
      ...(opts.extra ?? {}),
    }),
  )
  return { res, json: await body<ArticleDto>(res) }
}

async function getArticle(id: string, session: P6cSession = su): Promise<Envelope<ArticleDto>> {
  return body(await itemRoute.GET(reqFor(session, "GET", `${BASE}/${id}`), ctxOf(id)))
}

async function patchArticle(
  id: string,
  payload: Record<string, unknown>,
  session: P6cSession = su,
): Promise<{ res: Response; json: Envelope<ArticleDto> }> {
  const res = await itemRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}`, payload), ctxOf(id))
  return { res, json: await body<ArticleDto>(res) }
}

async function patchStatus(
  id: string,
  status: string,
  version: number,
  session: P6cSession = su,
): Promise<{ res: Response; json: Envelope<ArticleDto> }> {
  const res = await statusRoute.PATCH(reqFor(session, "PATCH", `${BASE}/${id}/status`, { status, version }), ctxOf(id))
  return { res, json: await body<ArticleDto>(res) }
}

async function deleteArticle(id: string, version: number, session: P6cSession = su): Promise<Response> {
  return itemRoute.DELETE(reqFor(session, "DELETE", `${BASE}/${id}?version=${version}`), ctxOf(id))
}

async function restoreArticle(id: string, version: number, session: P6cSession = su): Promise<Response> {
  return restoreRoute.POST(reqFor(session, "POST", `${BASE}/${id}/restore`, { version }), ctxOf(id))
}

async function catVersion(id: string): Promise<number> {
  const res = await catItemRoute.GET(reqFor(su, "GET", `/api/admin/v1/article-categories/${id}`), ctxOf(id))
  const json = await body<{ version: number }>(res)
  return json.data!.version
}

async function dbRow(id: string): Promise<Record<string, unknown>> {
  const rows = await rawQuery(env.pool, "SELECT * FROM articles WHERE id = ?", [id])
  return rows[0]!
}

async function countArticles(): Promise<number> {
  const rows = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM articles")
  return Number(rows[0]!.n)
}

async function countAllAudit(): Promise<number> {
  const rows = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM admin_audit_logs")
  return Number(rows[0]!.n)
}

beforeAll(async () => {
  env = await setupP6cEnv()
  su = await p6cLogin(env, "p6c_article_super", ["super_admin"])
  auditor = await p6cLogin(env, "p6c_article_auditor", ["auditor"])
  editor = await p6cLogin(env, "p6c_article_editor", ["content_editor"])
  cadmin = await p6cLogin(env, "p6c_article_cadmin", ["content_admin"])

  listRoute = await import("../../src/app/api/admin/v1/articles/route")
  itemRoute = await import("../../src/app/api/admin/v1/articles/[id]/route")
  statusRoute = await import("../../src/app/api/admin/v1/articles/[id]/status/route")
  restoreRoute = await import("../../src/app/api/admin/v1/articles/[id]/restore/route")
  previewRoute = await import("../../src/app/api/admin/v1/articles/preview/route")
  catRoute = await import("../../src/app/api/admin/v1/article-categories/route")
  catItemRoute = await import("../../src/app/api/admin/v1/article-categories/[id]/route")
  catStatusRoute = await import("../../src/app/api/admin/v1/article-categories/[id]/status/route")

  for (const name of ["p6c_分类A", "p6c_分类B"]) {
    const res = await catRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name }))
    expect(res.status).toBe(200)
    const d = (await body<{ id: string }>(res)).data!
    CAT[name === "p6c_分类A" ? "catA" : "catB"] = { id: d.id, name }
  }
}, 240_000)

afterAll(async () => {
  await teardownP6cEnv(env)
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：新建合同（POST /articles）", () => {
  it("最小新建：draft / AUTO_INCREMENT 十进制字符串 ID / viewCount 字符串 / 空串默认值", async () => {
    const { res, json } = await createArticle("p6c_最小新建")
    expect(res.status).toBe(200)
    const d = json.data!
    expect(d.id).toMatch(/^[1-9]\d*$/)
    expect(d.status).toBe("draft")
    expect(d.publishedAt).toBeNull()
    expect(d.version).toBe(1)
    expect(d.viewCount).toBe("0")
    expect(d.deletedAt).toBeNull()
    expect(d.contentHtml).toBe("")
    expect(d.coverImage).toBe("")
    expect(d.seoTitle).toBe("")
    expect(d.categoryId).toBe(CAT.catA.id)
    expect(d.title).toBe("p6c_最小新建")
  })

  it("authorName = 当前管理员 displayName（服务端定）；categoryName = 实时分类名快照", async () => {
    const { json } = await createArticle("p6c_作者与分类快照")
    const d = json.data!
    expect(d.authorName).toBe(expectedAuthorName(su.admin.username))
    expect(d.categoryName).toBe("p6c_分类A")
    const row = await dbRow(d.id)
    expect(String(row.author_name)).toBe(expectedAuthorName(su.admin.username))
    expect(String(row.category_name_snapshot)).toBe("p6c_分类A")
  })

  it("正文服务端净化入库（onclick/script 剥离）", async () => {
    const { json } = await createArticle("p6c_净化入库", {
      extra: { contentHtml: '<p onclick="alert(1)">Hi</p><script>alert(2)</script>' },
    })
    expect(json.data!.contentHtml).toBe("<p>Hi</p>")
    const row = await dbRow(json.data!.id)
    expect(String(row.content_html)).toBe("<p>Hi</p>")
  })

  it("受保护字段出现在 body → 422（strictObject，而不是静默忽略）", async () => {
    for (const field of ["status", "authorName", "viewCount", "publishedAt", "categoryNameSnapshot", "deletedAt"]) {
      const res = await listRoute.POST(
        reqFor(su, "POST", BASE, { title: "p6c_受保护", categoryId: CAT.catA.id, [field]: "x" }),
      )
      const e = await errBody(res)
      expect(res.status, field).toBe(422)
      expect(e.error.code, field).toBe("VALIDATION_ERROR")
      expect(Object.values(e.error.fields ?? {}).join(" "), field).toContain(field)
    }
  })

  it("字段校验：标题空/超长、categoryId 非法、正文超长（Zod 上限 100000 字符）", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: "", categoryId: CAT.catA.id }, "title"],
      [{ title: "x".repeat(501), categoryId: CAT.catA.id }, "title"],
      [{ title: "p6c_坏分类", categoryId: "1e5" }, "categoryId"],
      [{ title: "p6c_超长正文", categoryId: CAT.catA.id, contentHtml: "x".repeat(100_001) }, "contentHtml"],
    ]
    for (const [payload, field] of cases) {
      const res = await listRoute.POST(reqFor(su, "POST", BASE, payload))
      const e = await errBody(res)
      expect(res.status, JSON.stringify(payload).slice(0, 80)).toBe(422)
      expect(e.error.fields?.[field] ?? e.error.message, field).toBeTruthy()
    }
    const long = await listRoute.POST(
      reqFor(su, "POST", BASE, { title: "p6c_超长正文2", categoryId: CAT.catA.id, contentHtml: "x".repeat(100_001) }),
    )
    expect((await errBody(long)).error.fields?.contentHtml).toContain("正文不能超过 100000 个字符")
  })

  it("分类校验：新建允许停用分类；幽灵分类/已删分类 409", async () => {
    const dis = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "disabled",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(dis.status).toBe(200)
    const ok = await createArticle("p6c_停用分类可新建", { categoryId: CAT.catB.id })
    expect(ok.res.status).toBe(200) // 编辑期允许挂停用分类，发布才要求启用
    for (const ghost of ["999999999999", "999999999998"]) {
      const res = await listRoute.POST(reqFor(su, "POST", BASE, { title: "p6c_幽灵分类", categoryId: ghost }))
      const e = await errBody(res)
      expect(res.status).toBe(409)
      expect(e.error.message).toContain("所属分类不存在")
    }
    const re = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "active",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(re.status).toBe(200)
  })

  it("CSRF / 未认证 / 方法不允许", async () => {
    const noCsrf = await listRoute.POST(
      reqFor(su, "POST", BASE, { title: "p6c_csrf", categoryId: CAT.catA.id }, { noCsrf: true }),
    )
    expect(noCsrf.status).toBe(403)
    expect((await errBody(noCsrf)).error.code).toBe("CSRF_INVALID")
    const anon = await listRoute.POST(
      reqFor(su, "POST", BASE, { title: "p6c_anon", categoryId: CAT.catA.id }, { noAuth: true }),
    )
    expect(anon.status).toBe(401)
    expect((await listRoute.PUT(reqFor(su, "GET", BASE))).status).toBe(405)
  })

  it("article.create 审计：同事务 / resource_type=article / 正文只存 digest", async () => {
    const { json } = await createArticle("p6c_审计新建")
    const id = json.data!.id
    const rows = await auditRows(env.pool, "article.create")
    const row = rows.find((r) => r.resource_id === id)
    expect(row).toBeTruthy()
    expect(row!.actor_user_id).toBe(String(su.admin.id))
    expect(row!.resource_type).toBe("article")
    expect(row!.request_id).toBeTruthy()
    const after = auditJson(row!.after_json)
    expect(after.title).toBe("p6c_审计新建")
    expect(after.status).toBe("draft")
    expect(after.contentHtml).toEqual({ length: 0, sha256: createHash("sha256").update("", "utf8").digest("hex") })
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：详情与列表（GET）", () => {
  let artA: ArticleDto
  beforeAll(async () => {
    artA = (await createArticle("p6c_详情样本")).json.data!
  })

  it("GET 详情：DTO 字段合同（categoryName 快照 / viewCount 字符串）", async () => {
    const env2 = await getArticle(artA.id)
    const d = env2.data!
    expect(d.id).toBe(artA.id)
    expect(d.categoryName).toBe("p6c_分类A")
    expect(typeof d.viewCount).toBe("string")
    expect(d.createdAt).toBeTruthy()
    expect(d.updatedAt).toBeTruthy()
  })

  it("ID 非法 422；不存在 404；软删除行 GET 仍可见（回收站编辑）", async () => {
    const bad = await itemRoute.GET(reqFor(su, "GET", `${BASE}/1e5`), ctxOf("1e5"))
    expect(bad.status).toBe(422)
    const gone = await itemRoute.GET(reqFor(su, "GET", `${BASE}/999999999997`), ctxOf("999999999997"))
    expect(gone.status).toBe(404)
    expect((await errBody(gone)).error.code).toBe("ARTICLE_NOT_FOUND")

    const seeded = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, title: "p6c_种子已删", deleted: true })
    const del = await itemRoute.GET(reqFor(su, "GET", `${BASE}/${seeded}`), ctxOf(seeded))
    expect(del.status).toBe(200)
    expect((await body<ArticleDto>(del)).data!.deletedAt).toBeTruthy()
  })

  it("列表：q 命中标题与作者名；categoryId / status 过滤", async () => {
    await seedArticleRaw(env.db, { categoryId: CAT.catA.id, title: "p6cQ_甲文章", authorName: "p6cQ_作者甲" })
    await seedArticleRaw(env.db, { categoryId: CAT.catB.id, title: "p6cQ_乙文章", status: "published" })
    const byTitle = await body<PageResult<ArticleDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_甲`)),
    )
    expect(byTitle.data!.items.map((i) => i.title)).toContain("p6cQ_甲文章")
    expect(byTitle.data!.items.every((i) => i.title.includes("p6cQ_甲") || i.authorName.includes("p6cQ_甲"))).toBe(true)
    const byAuthor = await body<PageResult<ArticleDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_作者甲`)),
    )
    expect(byAuthor.data!.items.map((i) => i.title)).toContain("p6cQ_甲文章")
    const byCat = await body<PageResult<ArticleDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_&categoryId=${CAT.catB.id}`)),
    )
    expect(byCat.data!.items.every((i) => i.categoryId === CAT.catB.id)).toBe(true)
    const byStatus = await body<PageResult<ArticleDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_&status=published`)),
    )
    expect(byStatus.data!.items.every((i) => i.status === "published")).toBe(true)
    expect(byStatus.data!.items.map((i) => i.title)).toContain("p6cQ_乙文章")
  })

  it("列表：默认排除软删除；includeDeleted=true 含已删", async () => {
    const normal = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6c_种子已删`)))
    expect(normal.data!.items).toHaveLength(0)
    const trash = await body<PageResult<ArticleDto>>(
      await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6c_种子已删&includeDeleted=true`)),
    )
    expect(trash.data!.items.map((i) => i.title)).toContain("p6c_种子已删")
  })

  it("列表：sortBy=id 升/降序严格有序；默认 updatedAt desc", async () => {
    const asc = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?sortBy=id&sortDir=asc&pageSize=100`)))
    const ascIds = asc.data!.items.map((i) => BigInt(i.id))
    for (let i = 1; i < ascIds.length; i++) expect(ascIds[i]! > ascIds[i - 1]!).toBe(true)
    const desc = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?sortBy=id&sortDir=desc&pageSize=100`)))
    const descIds = desc.data!.items.map((i) => BigInt(i.id))
    for (let i = 1; i < descIds.length; i++) expect(descIds[i]! < descIds[i - 1]!).toBe(true)
    const def = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?pageSize=100`)))
    const times = def.data!.items.map((i) => i.updatedAt)
    for (let i = 1; i < times.length; i++) expect(times[i - 1]! >= times[i]!).toBe(true)
  })

  it("列表：viewCount BIGINT 十进制字符串原样透出", async () => {
    const id = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, title: "p6cQ_浏览量大数", viewCount: 1234567890123 })
    const list = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_浏览量大数`)))
    expect(list.data!.items.find((i) => i.id === id)!.viewCount).toBe("1234567890123")
  })

  it("列表：分页 page 回显；pageSize=30 / page=0 / q 超长 / 非法枚举 → 422", async () => {
    const p1 = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_&pageSize=20&page=1`)))
    const p2 = await body<PageResult<ArticleDto>>(await listRoute.GET(reqFor(su, "GET", `${BASE}?q=p6cQ_&pageSize=20&page=2`)))
    expect(p1.data!.page).toBe(1)
    expect(p1.data!.pageSize).toBe(20)
    expect(p2.data!.page).toBe(2)
    const p1Ids = p1.data!.items.map((i) => i.id)
    expect(p2.data!.items.every((i) => !p1Ids.includes(i.id))).toBe(true)
    for (const qs of ["pageSize=30", "page=0", "q=" + "x".repeat(101), "sortBy=zzz", "status=drafting", "categoryId=1e5", "includeDeleted=yes"]) {
      const res = await listRoute.GET(reqFor(su, "GET", `${BASE}?${qs}`))
      expect(res.status, qs).toBe(422)
    }
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：编辑（PATCH，无 status）", () => {
  it("改标题/SEO：版本 +1；categoryName 快照不随实时改名变化（不分类时）", async () => {
    const { json } = await createArticle("p6c_编辑前标题", { extra: { seoTitle: "旧 SEO" } })
    const id = json.data!.id
    const v = json.data!.version
    const { res, json: upd } = await patchArticle(id, { title: "p6c_编辑后标题", seoTitle: "新 SEO", version: v })
    expect(res.status).toBe(200)
    expect(upd.data!.title).toBe("p6c_编辑后标题")
    expect(upd.data!.seoTitle).toBe("新 SEO")
    expect(upd.data!.version).toBe(v + 1)
    expect(upd.data!.status).toBe("draft")
    expect(upd.data!.categoryName).toBe("p6c_分类A")
  })

  it("换分类：categoryName 快照同步为新分类名", async () => {
    const { json } = await createArticle("p6c_换分类")
    const id = json.data!.id
    const { json: upd } = await patchArticle(id, { categoryId: CAT.catB.id, version: json.data!.version })
    expect(upd.data!.categoryId).toBe(CAT.catB.id)
    expect(upd.data!.categoryName).toBe("p6c_分类B")
  })

  it("正文 PATCH 净化入库；净化后与库内一致的正文不产生 contentHtml 审计 diff", async () => {
    const { json } = await createArticle("p6c_正文净化PATCH", {
      extra: { contentHtml: '<p style="color:#fff">保留</p>' },
    })
    const id = json.data!.id
    const { res, json: upd } = await patchArticle(id, {
      contentHtml: '<script>bad</script><p style="color:#fff">保留</p>',
      version: json.data!.version,
    })
    expect(res.status).toBe(200)
    expect(upd.data!.contentHtml).toBe('<p style="color:#fff">保留</p>')
    const rows = await auditRows(env.pool, "article.update")
    const row = rows.filter((r) => r.resource_id === id).at(-1)
    expect(row).toBeTruthy()
    expect(auditJson(row!.after_json).contentHtml).toBeUndefined() // 净化后与库内一致 → 审计记「正文未变」
  })

  it("乐观锁：旧 version → 409 VERSION_CONFLICT，且不产生部分写入", async () => {
    const { json } = await createArticle("p6c_版本冲突")
    const id = json.data!.id
    await patchArticle(id, { title: "p6c_第一次改", version: json.data!.version })
    const { res, json: bad } = await patchArticle(id, { title: "p6c_第二次改", version: json.data!.version })
    expect(res.status).toBe(409)
    expect(bad.error!.code).toBe("VERSION_CONFLICT")
    expect(bad.error!.message).toBe(VERSION_CONFLICT_MSG)
    const row = await dbRow(id)
    expect(String(row.title)).toBe("p6c_第一次改")
  })

  it("受保护字段进 PATCH → 422；只带 version（无字段）→ 422「没有需要修改的字段」", async () => {
    const { json } = await createArticle("p6c_PATCH受保护")
    const id = json.data!.id
    for (const field of ["status", "authorName", "viewCount", "publishedAt", "deletedAt"]) {
      const { res } = await patchArticle(id, { [field]: "x", version: json.data!.version })
      expect(res.status, field).toBe(422)
    }
    const empty = await patchArticle(id, { version: json.data!.version })
    expect(empty.res.status).toBe(422)
    const emptyErr = empty.json.error!
    expect(`${emptyErr.message} ${Object.values(emptyErr.fields ?? {}).join(" ")}`).toContain("没有需要修改的字段")
  })

  it("软删除行 / 幽灵 ID PATCH → 404", async () => {
    const seeded = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, deleted: true })
    const { res } = await patchArticle(seeded, { title: "p6c_改已删", version: 1 })
    expect(res.status).toBe(404)
    const ghost = await patchArticle("999999999996", { title: "p6c_改幽灵", version: 1 })
    expect(ghost.res.status).toBe(404)
  })

  it("换到已删分类 → 409 且整事务回滚（标题不残留、无审计）", async () => {
    const catC = (await body<{ id: string }>(
      await catRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6c_分类C" })),
    )).data!.id
    const { json } = await createArticle("p6c_回滚场景") // 挂 catA 下
    const id = json.data!.id
    const v = json.data!.version
    // 删除要求「含已删除」计数为 0——空分类可直接软删
    const delCat = await catItemRoute.DELETE(
      reqFor(su, "DELETE", `/api/admin/v1/article-categories/${catC}?version=${await catVersion(catC)}`),
      ctxOf(catC),
    )
    expect(delCat.status).toBe(200)

    const auditBefore = await countAudit(env.pool, "article.update")
    const { res, json: bad } = await patchArticle(id, { title: "p6c_标题不该变", categoryId: catC, version: v })
    expect(res.status).toBe(409)
    expect(bad.error!.message).toContain("所属分类不存在")
    const row = await dbRow(id)
    expect(String(row.title)).toBe("p6c_回滚场景") // 回滚：PATCH 里合法的部分也没写进去
    expect(String(row.category_id)).toBe(CAT.catA.id)
    expect(String(row.category_name_snapshot)).toBe("p6c_分类A")
    expect(await countAudit(env.pool, "article.update")).toBe(auditBefore) // 失败写操作零审计
  })

  it("article.update 审计：标量记 before/after，正文只记 digest 对", async () => {
    const { json } = await createArticle("p6c_审计编辑", { extra: { contentHtml: "<p>旧正文</p>" } })
    const id = json.data!.id
    const { res } = await patchArticle(id, { title: "p6c_审计编辑2", contentHtml: "<p>新正文</p>", version: json.data!.version })
    expect(res.status).toBe(200)
    const rows = await auditRows(env.pool, "article.update")
    const row = auditJson(rows.find((r) => r.resource_id === id)!.before_json)
    const after = auditJson(rows.find((r) => r.resource_id === id)!.after_json)
    expect(row.title).toBe("p6c_审计编辑")
    expect(after.title).toBe("p6c_审计编辑2")
    expect(row.contentHtml.sha256).toBe(createHash("sha256").update("<p>旧正文</p>", "utf8").digest("hex"))
    expect(after.contentHtml.sha256).toBe(createHash("sha256").update("<p>新正文</p>", "utf8").digest("hex"))
    expect(after.contentHtml.length).toBe("<p>新正文</p>".length)
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：状态机（PATCH /status，articles.publish）", () => {
  it("矩阵：draft→published / draft→archived / archived→published 放行；published→draft 撤回 422", async () => {
    const a = (await createArticle("p6c_矩阵A", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    const pubA = await patchStatus(a.id, "published", a.version)
    expect(pubA.res.status).toBe(200)
    expect(pubA.json.data!.status).toBe("published")

    const b = (await createArticle("p6c_矩阵B", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    const archB = await patchStatus(b.id, "archived", b.version)
    expect(archB.res.status).toBe(200)

    const repub = await patchStatus(b.id, "published", archB.json.data!.version)
    expect(repub.res.status).toBe(200)
    expect(repub.json.data!.status).toBe("published")

    const back = await patchStatus(a.id, "draft", pubA.json.data!.version)
    expect(back.res.status).toBe(422)
    expect(back.json.error!.code).toBe("ARTICLE_STATUS_TRANSITION")
    expect(back.json.error!.message).toBe("不允许从已发布变更为草稿（已归档的文章可直接再发布）")
  })

  it("同态切换 422（已处于该状态）；非法枚举与缺 version 422", async () => {
    const a = (await createArticle("p6c_同态")).json.data!
    const same = await patchStatus(a.id, "draft", a.version)
    expect(same.res.status).toBe(422)
    expect(same.json.error!.message).toBe("文章已处于草稿状态")
    const badBody = await statusRoute.PATCH(
      reqFor(su, "PATCH", `${BASE}/${a.id}/status`, { status: "pending", version: a.version }),
      ctxOf(a.id),
    )
    expect(badBody.status).toBe(422)
    const noVer = await statusRoute.PATCH(reqFor(su, "PATCH", `${BASE}/${a.id}/status`, { status: "published" }), ctxOf(a.id))
    expect(noVer.status).toBe(422)
  })

  it("publishedAt：草稿为 null；首发写入；归档→再发布与编辑均不覆盖", async () => {
    const { json } = await createArticle("p6c_发布时间语义", { extra: { contentHtml: "<p>正文</p>" } })
    let d = json.data!
    expect(d.publishedAt).toBeNull()
    d = (await patchStatus(d.id, "published", d.version)).json.data!
    const firstPublishedAt = d.publishedAt!
    expect(firstPublishedAt).toMatch(/^2026-\d{2}-\d{2} /)
    d = (await patchStatus(d.id, "archived", d.version)).json.data!
    expect(d.publishedAt).toBe(firstPublishedAt)
    d = (await patchArticle(d.id, { title: "p6c_发布时间语义2", version: d.version })).json.data!
    expect(d.publishedAt).toBe(firstPublishedAt)
    d = (await patchStatus(d.id, "published", d.version)).json.data!
    expect(d.publishedAt).toBe(firstPublishedAt)
  })

  it("发布闸门：正文净化后为空 422「正文为空，不能发布」（无审计、状态不变）", async () => {
    const { json } = await createArticle("p6c_空正文发布", {
      extra: { contentHtml: "<script>alert(1)</script>   " },
    })
    const id = json.data!.id
    const auditBefore = await countAudit(env.pool, "article.publish")
    const st = await patchStatus(id, "published", json.data!.version)
    expect(st.res.status).toBe(422)
    expect(st.json.error!.message).toBe("正文为空，不能发布")
    const row = await dbRow(id)
    expect(String(row.status)).toBe("draft")
    expect(await countAudit(env.pool, "article.publish")).toBe(auditBefore)
  })

  it("发布闸门：分类停用 409；分类被删 409；均不产生审计", async () => {
    let dis = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "disabled",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(dis.status).toBe(200)
    const seeded = await seedArticleRaw(env.db, { categoryId: CAT.catB.id, title: "p6c_停用分类发布", contentHtml: "<p>正文</p>" })
    const auditBefore = await countAudit(env.pool, "article.publish")
    const gateDis = await patchStatus(seeded, "published", 1)
    expect(gateDis.res.status).toBe(409)
    expect(gateDis.json.error!.message).toBe("所属分类处于停用状态，请先启用该分类")
    dis = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "active",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(dis.status).toBe(200)

    // 空分类软删后直接 seed 文章（绕过 API 分类校验）→ 发布报「分类不存在」
    const catD = (await body<{ id: string }>(
      await catRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6c_分类D" })),
    )).data!.id
    const del = await catItemRoute.DELETE(
      reqFor(su, "DELETE", `/api/admin/v1/article-categories/${catD}?version=${await catVersion(catD)}`),
      ctxOf(catD),
    )
    expect(del.status).toBe(200)
    const seededD = await seedArticleRaw(env.db, { categoryId: catD, title: "p6c_已删分类发布", contentHtml: "<p>正文</p>" })
    const gateDel = await patchStatus(seededD, "published", 1)
    expect(gateDel.res.status).toBe(409)
    expect(gateDel.json.error!.message).toContain("所属分类不存在")
    expect(await countAudit(env.pool, "article.publish")).toBe(auditBefore)
  })

  it("发布闸门顺带收敛历史脏正文（publish 即清洗，同事务写回）", async () => {
    const legacy = '<p onclick="alert(1)">历史正文</p><script>bad()</script>'
    const id = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, title: "p6c_历史脏正文", contentHtml: legacy })
    const { res, json } = await patchStatus(id, "published", 1)
    expect(res.status).toBe(200)
    expect(json.data!.contentHtml).toBe("<p>历史正文</p>")
    expect(String((await dbRow(id)).content_html)).toBe("<p>历史正文</p>")
    // 审计里前后 digest 都存在（正文确实变了）
    const rows = await auditRows(env.pool, "article.publish")
    const row = rows.find((r) => r.resource_id === id)!
    const before = auditJson(row.before_json)
    expect(before.contentHtml.sha256).toBe(createHash("sha256").update(legacy, "utf8").digest("hex"))
    expect(auditJson(row.after_json).contentHtml.sha256).toBe(
      createHash("sha256").update("<p>历史正文</p>", "utf8").digest("hex"),
    )
  })

  it("status 端点：软删行 404；旧 version 409；GET → 405", async () => {
    const seeded = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, deleted: true })
    const delRes = await patchStatus(seeded, "published", 1)
    expect(delRes.res.status).toBe(404)
    const a = (await createArticle("p6c_status版本", { extra: { contentHtml: "<p>正文</p>" } })).json.data!
    const stale = await patchStatus(a.id, "published", 99)
    expect(stale.res.status).toBe(409)
    expect((await statusRoute.GET(reqFor(su, "GET", `${BASE}/${a.id}/status`))).status).toBe(405)
  })

  it("article.publish / article.archive 审计（before.status 语义正确）", async () => {
    const { json } = await createArticle("p6c_状态审计", { extra: { contentHtml: "<p>正文</p>" } })
    const id = json.data!.id
    let d = (await patchStatus(id, "published", json.data!.version)).json.data!
    d = (await patchStatus(id, "archived", d.version)).json.data!
    expect(d.status).toBe("archived")
    const pubRows = await auditRows(env.pool, "article.publish")
    const archRows = await auditRows(env.pool, "article.archive")
    const pub = pubRows.find((r) => r.resource_id === id)!
    const arch = archRows.find((r) => r.resource_id === id)!
    expect(auditJson(pub.before_json).status).toBe("draft")
    expect(auditJson(pub.after_json).status).toBe("published")
    expect(auditJson(arch.before_json).status).toBe("published")
    expect(auditJson(arch.after_json).status).toBe("archived")
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：软删除与恢复（DELETE / POST restore）", () => {
  it("软删除：deletedAt 写入、状态保留；再删/编辑/改状态均 404", async () => {
    const { json } = await createArticle("p6c_软删除", { extra: { contentHtml: "<p>正文</p>" } })
    let d = json.data!
    d = (await body<ArticleDto>(await deleteArticle(d.id, d.version))).data!
    expect(d.deletedAt).toBeTruthy()
    expect(d.status).toBe("draft")
    expect((await deleteArticle(d.id, d.version)).status).toBe(404)
    expect((await patchArticle(d.id, { title: "p6c_删后改", version: d.version })).res.status).toBe(404)
    expect((await patchStatus(d.id, "published", d.version)).res.status).toBe(404)
  })

  it("软删除旧 version → 409；缺 version 参数 → 422", async () => {
    const { json } = await createArticle("p6c_删版本")
    const id = json.data!.id
    expect((await deleteArticle(id, 99)).status).toBe(409)
    const noVer = await itemRoute.DELETE(reqFor(su, "DELETE", `${BASE}/${id}`), ctxOf(id))
    expect(noVer.status).toBe(422)
  })

  it("恢复保留原状态（archived 恢复后仍 archived）；未删除行恢复 → 422", async () => {
    const { json } = await createArticle("p6c_归档后删")
    let d = (await patchStatus(json.data!.id, "archived", json.data!.version)).json.data!
    d = (await body<ArticleDto>(await deleteArticle(d.id, d.version))).data!
    const restored = await restoreArticle(d.id, d.version)
    expect(restored.status).toBe(200)
    const r = (await body<ArticleDto>(restored)).data!
    expect(r.deletedAt).toBeNull()
    expect(r.status).toBe("archived")
    // 已恢复 → 再恢复 422
    const again = await restoreArticle(r.id, r.version)
    expect(again.status).toBe(422)
    expect((await errBody(again)).error.message).toBe("该文章未被删除，无需恢复")
  })

  it("恢复 version 不符 → 409；幽灵 ID → 404；GET restore → 405", async () => {
    const { json } = await createArticle("p6c_恢复版本")
    const id = json.data!.id
    const d = (await body<ArticleDto>(await deleteArticle(id, json.data!.version))).data!
    expect((await restoreArticle(id, 99)).status).toBe(409)
    expect((await restoreArticle("999999999995", 1)).status).toBe(404)
    const restored = await restoreArticle(id, d.version)
    expect(restored.status).toBe(200)
    expect((await restoreRoute.GET(reqFor(su, "GET", `${BASE}/${id}/restore`))).status).toBe(405)
  })

  it("分类被删 → 恢复 409 ARTICLE_RESTORE_BLOCKED；先恢复分类再恢复文章则成功", async () => {
    const catE = (await body<{ id: string }>(
      await catRoute.POST(reqFor(su, "POST", "/api/admin/v1/article-categories", { name: "p6c_分类E" })),
    )).data!.id
    // 空分类先软删，再直插文章到已删分类（API 侧新建不允许挂已删分类，只能 seed 模拟「先有文章后删分类」）
    const delCat = await catItemRoute.DELETE(
      reqFor(su, "DELETE", `/api/admin/v1/article-categories/${catE}?version=${await catVersion(catE)}`),
      ctxOf(catE),
    )
    expect(delCat.status).toBe(200)
    const id = await seedArticleRaw(env.db, {
      categoryId: catE,
      title: "p6c_分类删恢复",
      contentHtml: "<p>正文</p>",
    })
    const delArt = await body<ArticleDto>(await deleteArticle(id, 1))
    expect(delArt.data!.deletedAt).toBeTruthy()

    const blocked = await restoreArticle(id, delArt.data!.version)
    expect(blocked.status).toBe(409)
    const blockedBody = await errBody(blocked)
    expect(blockedBody.error.code).toBe("ARTICLE_RESTORE_BLOCKED")
    expect(blockedBody.error.message).toContain("所属分类不存在")
    expect((await dbRow(id)).deleted_at).toBeTruthy() // 阻断时保留删除态

    const catV = await catVersion(catE)
    const restoredCat = await (
      await import("../../src/app/api/admin/v1/article-categories/[id]/restore/route")
    ).POST(reqFor(su, "POST", `/api/admin/v1/article-categories/${catE}/restore`, { version: catV }), ctxOf(catE))
    expect(restoredCat.status).toBe(200)
    const ok = await restoreArticle(id, delArt.data!.version)
    expect(ok.status).toBe(200)
  })

  it("已发布文章：分类停用时恢复 409；分类启用后恢复成功且 publishedAt 保留", async () => {
    let dis = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "disabled",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(dis.status).toBe(200)
    const id = await seedArticleRaw(env.db, {
      categoryId: CAT.catB.id,
      title: "p6c_停用恢复已发布",
      status: "published",
      publishedAt: "2026-01-02 03:04:05.000",
    })
    // 软删（走 API：version=1）
    const del = await deleteArticle(id, 1)
    expect(del.status).toBe(200)
    const delDto = (await body<ArticleDto>(del)).data!
    const blocked = await restoreArticle(id, delDto.version)
    expect(blocked.status).toBe(409)
    expect((await errBody(blocked)).error.code).toBe("ARTICLE_RESTORE_BLOCKED")
    dis = await catStatusRoute.PATCH(
      reqFor(su, "PATCH", `/api/admin/v1/article-categories/${CAT.catB.id}/status`, {
        status: "active",
        version: await catVersion(CAT.catB.id),
      }),
      ctxOf(CAT.catB.id),
    )
    expect(dis.status).toBe(200)
    const ok = await restoreArticle(id, delDto.version)
    expect(ok.status).toBe(200)
    const r = (await body<ArticleDto>(ok)).data!
    expect(r.status).toBe("published")
    expect(r.publishedAt).toBe("2026-01-02 03:04:05.000")
  })

  it("article.soft_delete / article.restore 审计（deleted_at 前后语义）", async () => {
    const { json } = await createArticle("p6c_删除审计")
    const id = json.data!.id
    const d = (await body<ArticleDto>(await deleteArticle(id, json.data!.version))).data!
    const restored = (await body<ArticleDto>(await restoreArticle(id, d.version))).data!
    const delRow = (await auditRows(env.pool, "article.soft_delete")).find((r) => r.resource_id === id)!
    const resRow = (await auditRows(env.pool, "article.restore")).find((r) => r.resource_id === id)!
    expect(auditJson(delRow.before_json).deleted_at).toBeNull()
    expect(auditJson(delRow.after_json).deleted_at).toBeTruthy()
    expect(auditJson(resRow.before_json).deleted_at).toBeTruthy()
    expect(auditJson(resRow.after_json).deleted_at).toBeNull()
    expect(restored.deletedAt).toBeNull()
    expect(restored.status).toBe("draft")
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：预览（POST /articles/preview）", () => {
  it("净化回显：不落库、不写审计", async () => {
    const rowsBefore = await countArticles()
    const auditBefore = await countAllAudit()
    const res = await previewRoute.POST(
      reqFor(su, "POST", `${BASE}/preview`, { contentHtml: '<p onclick="alert(1)">预览</p><script>bad</script>', title: "p6c_预览标题" }),
    )
    expect(res.status).toBe(200)
    const json = await body<{ html: string; title: string }>(res)
    expect(json.data!.html).toBe("<p>预览</p>")
    expect(json.data!.title).toBe("p6c_预览标题")
    expect(await countArticles()).toBe(rowsBefore)
    expect(await countAllAudit()).toBe(auditBefore)
  })

  it("权限：auditor（只读）403 FORBIDDEN；editor 可预览", async () => {
    const auditDenied = await previewRoute.POST(reqFor(auditor, "POST", `${BASE}/preview`, { contentHtml: "<p>x</p>" }))
    expect(auditDenied.status).toBe(403)
    const e = await errBody(auditDenied)
    expect(e.error.code).toBe("FORBIDDEN")
    expect(e.error.message).toBe("预览需要文章编辑权限")
    const editorOk = await previewRoute.POST(reqFor(editor, "POST", `${BASE}/preview`, { contentHtml: "<p>x</p>" }))
    expect(editorOk.status).toBe(200)
  })

  it("CSRF：缺 token → 403 CSRF_INVALID；GET → 405", async () => {
    const res = await previewRoute.POST(
      reqFor(su, "POST", `${BASE}/preview`, { contentHtml: "<p>x</p>" }, { noCsrf: true }),
    )
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("CSRF_INVALID")
    expect((await previewRoute.GET(reqFor(su, "GET", `${BASE}/preview`))).status).toBe(405)
  })

  it("body 合同：缺 contentHtml 422；超 100000 字符 422；>512KB JSON → 422「请求体过大」（非 413）", async () => {
    const missing = await previewRoute.POST(reqFor(su, "POST", `${BASE}/preview`, { title: "无正文" }))
    expect(missing.status).toBe(422)
    const tooLong = await previewRoute.POST(
      reqFor(su, "POST", `${BASE}/preview`, { contentHtml: "x".repeat(100_001) }),
    )
    expect(tooLong.status).toBe(422)
    const tlErr = await errBody(tooLong)
    expect(tlErr.error.fields?.contentHtml ?? tlErr.error.message).toContain("正文不能超过 100000 个字符")
    // 20 万个中文字符：UTF-8 后 >512KB → 体积闸先命中（先于 Zod 长度闸）
    const big = await previewRoute.POST(
      reqFor(su, "POST", `${BASE}/preview`, { contentHtml: "汉".repeat(200_000) }),
    )
    expect(big.status).toBe(422)
    const e = await errBody(big)
    expect(e.error.code).toBe("VALIDATION_ERROR")
    expect(e.error.message).toBe("请求体过大")
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：RBAC（4 角色 × 端点矩阵）", () => {
  it("auditor：读放行，全部写端点 403（且不产生审计）", async () => {
    const target = (await createArticle("p6c_RBAC审计员")).json.data!
    const auditBefore = await countAllAudit()
    expect((await listRoute.GET(reqFor(auditor, "GET", BASE))).status).toBe(200)
    expect((await itemRoute.GET(reqFor(auditor, "GET", `${BASE}/${target.id}`), ctxOf(target.id))).status).toBe(200)
    const writes: Array<[string, Promise<Response>]> = [
      ["POST", listRoute.POST(reqFor(auditor, "POST", BASE, { title: "p6c_a", categoryId: CAT.catA.id }))],
      ["PATCH", itemRoute.PATCH(reqFor(auditor, "PATCH", `${BASE}/${target.id}`, { title: "y", version: target.version }), ctxOf(target.id))],
      ["STATUS", statusRoute.PATCH(reqFor(auditor, "PATCH", `${BASE}/${target.id}/status`, { status: "published", version: target.version }), ctxOf(target.id))],
      ["DELETE", itemRoute.DELETE(reqFor(auditor, "DELETE", `${BASE}/${target.id}?version=${target.version}`), ctxOf(target.id))],
      ["RESTORE", restoreRoute.POST(reqFor(auditor, "POST", `${BASE}/${target.id}/restore`, { version: target.version }), ctxOf(target.id))],
    ]
    for (const [label, p] of writes) {
      const res = await p
      expect(res.status, label).toBe(403)
      expect((await errBody(res)).error.code, label).toBe("FORBIDDEN")
    }
    expect(await countAllAudit()).toBe(auditBefore)
  })

  it("content_editor：可增改/预览；发布、删除、恢复 403", async () => {
    const made = await createArticle("p6c_编辑者新建", { session: editor, extra: { contentHtml: "<p>正文</p>" } })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    expect((await patchArticle(id, { title: "p6c_编辑者改名", version: made.json.data!.version }, editor)).res.status).toBe(200)
    const afterPatch = await getArticle(id)
    expect((await previewRoute.POST(reqFor(editor, "POST", `${BASE}/preview`, { contentHtml: "<p>x</p>" }))).status).toBe(200)
    expect((await patchStatus(id, "published", afterPatch.data!.version, editor)).res.status).toBe(403)
    expect((await deleteArticle(id, afterPatch.data!.version, editor)).status).toBe(403)
    expect((await restoreArticle(id, afterPatch.data!.version, editor)).status).toBe(403)
    // super 收尾
    expect((await patchStatus(id, "published", afterPatch.data!.version)).res.status).toBe(200)
  })

  it("content_admin：内容全权（发布 + 删除 + 恢复都放行）", async () => {
    const made = await createArticle("p6c_内容管理员", { session: cadmin, extra: { contentHtml: "<p>正文</p>" } })
    expect(made.res.status).toBe(200)
    const id = made.json.data!.id
    expect((await patchStatus(id, "published", made.json.data!.version, cadmin)).res.status).toBe(200)
    const pub = (await getArticle(id, cadmin)).data!
    expect((await deleteArticle(id, pub.version, cadmin)).status).toBe(200)
    expect((await restoreArticle(id, pub.version + 1, cadmin)).status).toBe(200)
  })

  it("无会话访问读写端点均 401", async () => {
    expect((await listRoute.GET(reqFor(su, "GET", BASE, undefined, { noAuth: true }))).status).toBe(401)
    expect((await itemRoute.PATCH(reqFor(su, "PATCH", `${BASE}/1`, { title: "x", version: 1 }, { noAuth: true }), ctxOf("1"))).status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────

describe("P6C 文章：幂等与旁路防护", () => {
  it("同一净化输入多次保存结果一致（幂等收敛）", async () => {
    const dirty = '<p onclick="x()">正文<strong>粗</strong><script>bad</script></p>'
    const a = await createArticle("p6c_幂等A", { extra: { contentHtml: dirty } })
    const b = await createArticle("p6c_幂等B", { extra: { contentHtml: dirty } })
    expect(a.json.data!.contentHtml).toBe(b.json.data!.contentHtml)
    const repatch = await patchArticle(a.json.data!.id, { contentHtml: a.json.data!.contentHtml, version: a.json.data!.version })
    expect(repatch.json.data!.contentHtml).toBe(sanitizeRichHtml(dirty))
  })

  it("文章 ID 由 AUTO_INCREMENT 顺序生成（新建 id 大于此前 seed 的 id）", async () => {
    const seeded = await seedArticleRaw(env.db, { categoryId: CAT.catA.id, title: "p6c_自增基准" })
    const { json } = await createArticle("p6c_自增新建")
    expect(BigInt(json.data!.id) > BigInt(seeded)).toBe(true)
  })
})
