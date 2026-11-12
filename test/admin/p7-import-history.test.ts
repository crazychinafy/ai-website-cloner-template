// P7：导入历史（GET /api/admin/v1/imports、GET /imports/[id]）
// ─────────────────────────────────────────────────────────────────
// 合同断言（行直接用 SQL 造，覆盖 Web 路径写不出的形态）：
//   - CLI 触发行 started_by=NULL；已删除管理员 startedByDeleted=true 不丢行
//   - error_summary 读取时脱敏（连接串凭据 → 「***」）+ 截断 2000
//   - 过滤（mode/status/snapshotVersion/q/日期）+ 分页 + 422 校验
//   - 详情 404 / 非法 id 422；PUT/PATCH/DELETE 405（历史只增不改不删）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  errBody,
  okBody,
  p7Login,
  rawQuery,
  reqFor,
  setupP7Env,
  teardownP7Env,
  type P7Env,
  type P7Session,
} from "./p7-harness.ts"
import type { ImportPreviewDto, ImportRunDto } from "../../src/lib/admin/dto/import.ts"
import type { PageResult } from "../../src/lib/admin/dto/content.ts"

const CHECKSUM = "251537562d12b44c739e108471719eb4b99693141294d2656d7a09ff023e915f"

let env: P7Env
let auditor: P7Session
let contentAdmin: P7Session
let superS: P7Session
let route: typeof import("../../src/app/api/admin/v1/imports/route.ts")
let detailRoute: typeof import("../../src/app/api/admin/v1/imports/[id]/route.ts")

/** run 行主键（按 started_at 区分） */
const RUN = { cli: 0, web: 0, failed: 0, ghost: 0 }

async function listAs(session: P7Session, qs = ""): Promise<Response> {
  return route.GET(reqFor(session, "GET", `/api/admin/v1/imports${qs ? `?${qs}` : ""}`))
}
async function listData(session: P7Session, qs = ""): Promise<PageResult<ImportRunDto>> {
  const res = await listAs(session, qs)
  expect(res.status).toBe(200)
  return (await okBody<PageResult<ImportRunDto>>(res)).data
}

async function detailAs(session: P7Session, id: string): Promise<Response> {
  return detailRoute.GET(reqFor(session, "GET", `/api/admin/v1/imports/${id}`), {
    params: Promise.resolve({ id }),
  })
}

beforeAll(async () => {
  env = await setupP7Env()
  route = await import("../../src/app/api/admin/v1/imports/route.ts")
  detailRoute = await import("../../src/app/api/admin/v1/imports/[id]/route.ts")
  auditor = await p7Login(env, "p7hist_auditor", ["auditor"])
  contentAdmin = await p7Login(env, "p7hist_content", ["content_admin"])
  superS = await p7Login(env, "p7hist_super", ["super_admin"])

  // ── 历史行直接落库（含 Web 路径无法复现的 CLI/幽灵/超长错误形态） ──
  await rawQuery(
    env.pool,
    `insert into admin_import_runs (snapshot_version, mode, status, summary_json, checksum, started_by, started_at, finished_at, error_summary)
     values ('2026-11-08', 'import', 'succeeded', '{"counts":{"site_links":3791,"articles":280},"total":4182}',
             '${CHECKSUM}', NULL, '2026-11-08 01:00:00.000', '2026-11-08 01:00:05.000', NULL)`,
  )
  await rawQuery(
    env.pool,
    `insert into admin_import_runs (snapshot_version, mode, status, summary_json, checksum, started_by, started_at, finished_at, error_summary)
     values ('2026-11-08', 'import', 'succeeded', '{"counts":{"site_links":3791},"total":4182}',
             '${CHECKSUM}', ?, '2026-11-08 02:00:00.000', '2026-11-08 02:00:06.000', NULL)`,
    [superS.admin.id],
  )
  // 失败行：错误文本夹带连接串 / password= / 引号 api_key，且远超 2000 字符
  const noisy =
    `connect ECONNREFUSED mysql://facai8_admin:Sup3rS3cret@10.0.0.9:3306/facai8_admin ` +
    `password=Sup3rS3cret api_key="kkkk-7777" ` +
    "x".repeat(5000)
  await rawQuery(
    env.pool,
    `insert into admin_import_runs (snapshot_version, mode, status, summary_json, checksum, started_by, started_at, finished_at, error_summary)
     values ('2026-11-08', 'dry_run', 'failed', NULL, NULL, NULL, '2026-11-07 10:00:00.000', '2026-11-07 10:00:01.000', ?)`,
    [noisy],
  )
  // 幽灵操作人：started_by 指向已物理删除的用户（FK 检查关闭后直插）
  await rawQuery(env.pool, "set foreign_key_checks = 0")
  await rawQuery(
    env.pool,
    `insert into admin_import_runs (snapshot_version, mode, status, summary_json, checksum, started_by, started_at, finished_at, error_summary)
     values ('2026-11-06', 'import', 'succeeded', NULL, NULL, 999999999999999999,
             '2026-11-06 08:00:00.000', '2026-11-06 08:00:02.000', NULL)`,
  )
  await rawQuery(env.pool, "set foreign_key_checks = 1")

  const ids = await rawQuery<{ tag: string; id: string }>(
    env.pool,
    `select case started_at when '2026-11-08 01:00:00.000' then 'cli'
             when '2026-11-08 02:00:00.000' then 'web'
             when '2026-11-07 10:00:00.000' then 'failed'
             else 'ghost' end as tag, id
        from admin_import_runs order by id`,
  )
  for (const r of ids) {
    if (r.tag === "cli") RUN.cli = Number(r.id)
    if (r.tag === "web") RUN.web = Number(r.id)
    if (r.tag === "failed") RUN.failed = Number(r.id)
    if (r.tag === "ghost") RUN.ghost = Number(r.id)
  }
}, 180_000)

afterAll(async () => {
  await teardownP7Env(env)
})

describe("导入历史：列表（imports.preview；只读）", () => {
  it("401 / 403（content_admin 无 imports.preview）", async () => {
    expect((await route.GET(reqFor(auditor, "GET", "/api/admin/v1/imports", undefined, { noAuth: true }))).status).toBe(401)
    expect((await listAs(contentAdmin)).status).toBe(403)
  })

  it("默认列表：startedAt DESC；CLI NULL 发起人；幽灵发起人标记已删除且不丢行", async () => {
    const d = await listData(auditor)
    expect(d.total).toBe(4)
    expect(d.pageSize).toBe(20)
    expect(d.items.map((r) => r.id)).toEqual([String(RUN.web), String(RUN.cli), String(RUN.failed), String(RUN.ghost)])

    const web = d.items[0]!
    expect(web.startedBy).toBe(String(superS.admin.id))
    expect(web.startedByUsername).toBe("p7hist_super")
    expect(web.startedByDeleted).toBe(false)
    expect(web.status).toBe("succeeded")
    expect(web.checksum).toBe(CHECKSUM)
    expect(web.summary?.total).toBe(4182)
    expect(web.errorSummary).toBeNull()

    const cli = d.items[1]!
    expect(cli.startedBy).toBeNull() // CLI 触发：无管理员上下文
    expect(cli.startedByUsername).toBeNull()
    expect(cli.startedByDeleted).toBe(false) // NULL ≠ 已删除

    const ghost = d.items[3]!
    expect(ghost.startedBy).toBe("999999999999999999") // BIGINT → 十进制字符串
    expect(ghost.startedByUsername).toBeNull()
    expect(ghost.startedByDeleted).toBe(true) // UI 将显示「已删除管理员」
  })

  it("error_summary：读取时脱敏（连接串/password/api_key → ***）并截断到 2000 字符", async () => {
    const d = await listData(auditor, "status=failed")
    expect(d.total).toBe(1)
    const failed = d.items[0]!
    expect(failed.id).toBe(String(RUN.failed))
    expect(failed.summary).toBeNull()
    const es = failed.errorSummary!
    expect(es).toContain("***")
    expect(es).not.toContain("Sup3rS3cret")
    expect(es).not.toContain("kkkk-7777")
    expect(es.length).toBeLessThanOrEqual(2000) // 原始 5000+ 字符已被截断
  })

  it("过滤：mode / snapshotVersion / q(checksum LIKE) / 日期边界", async () => {
    expect((await listData(auditor, "mode=dry_run")).total).toBe(1)
    expect((await listData(auditor, "mode=import")).total).toBe(3)
    expect((await listData(auditor, "status=succeeded")).items.map((r) => r.id)).toEqual([
      String(RUN.web),
      String(RUN.cli),
      String(RUN.ghost),
    ])
    expect((await listData(auditor, "snapshotVersion=2026-11-06")).total).toBe(1)
    expect((await listData(auditor, `q=${CHECKSUM.slice(0, 16)}`)).total).toBe(2) // 版本不含该串 → 仅 checksum 命中
    expect((await listData(auditor, "startDate=2026-11-07&endDate=2026-11-07")).total).toBe(1) // 含当天两端
    expect((await listData(auditor, "startDate=2026-11-08&endDate=2026-11-08")).total).toBe(2)
  })

  it("分页与排序：pageSize 越界 422；page=2 空页；sortBy=id&dir=asc 正序", async () => {
    const bad = await listAs(auditor, "pageSize=30")
    expect(bad.status).toBe(422)
    const p2 = await listData(auditor, "pageSize=20&page=2")
    expect(p2.total).toBe(4)
    expect(p2.totalPages).toBe(1)
    expect(p2.items).toHaveLength(0) // 4 行都在第 1 页
    const asc = await listData(auditor, "sortBy=id&sortDir=asc")
    expect(asc.items.map((r) => r.id)).toEqual([String(RUN.cli), String(RUN.web), String(RUN.failed), String(RUN.ghost)])
  })

  it("非法查询 → 422（sortBy 白名单外 / 日期倒置）", async () => {
    expect((await listAs(auditor, "sortBy=bogus")).status).toBe(422)
    expect((await listAs(auditor, "startDate=2026-11-09&endDate=2026-11-01")).status).toBe(422)
  })
})

describe("导入历史：详情与只读合同", () => {
  it("详情 200：字段与列表一致；CLI 行 startedBy=null", async () => {
    const res = await detailAs(auditor, String(RUN.cli))
    expect(res.status).toBe(200)
    const one = (await okBody<ImportRunDto>(res)).data
    expect(one.id).toBe(String(RUN.cli))
    expect(one.startedBy).toBeNull()
    expect(one.mode).toBe("import")
    expect(one.finishedAt).toBe("2026-11-08 01:00:05.000")
  })

  it("不存在 → 404 IMPORT_RUN_NOT_FOUND；非法 id → 422", async () => {
    const nf = await detailAs(auditor, "999999999999")
    expect(nf.status).toBe(404)
    expect((await errBody(nf)).error.code).toBe("IMPORT_RUN_NOT_FOUND")
    expect((await detailAs(auditor, "abc")).status).toBe(422)
  })

  it("无权限详情 → 403（隐藏菜单 ≠ 授权）", async () => {
    expect((await detailAs(contentAdmin, String(RUN.cli))).status).toBe(403)
  })

  it("POST /imports/preview 预览零写入：历史行前后一字不变", async () => {
    const previewRoute = await import("../../src/app/api/admin/v1/imports/preview/route.ts")
    const before = await listData(auditor)
    const pv = await previewRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/imports/preview", {}))
    expect(pv.status).toBe(200)
    const { data } = await okBody<ImportPreviewDto>(pv)
    expect(data.snapshotVersion).toBe("2026-11-08")
    // 内容表全空（本文件从不执行导入）→ 预览结论是可执行，但历史不因此变化
    expect(data.dbState).toBe("empty")
    const after = await listData(auditor)
    expect(after.total).toBe(before.total)
    expect(after.items.map((r) => r.id)).toEqual(before.items.map((r) => r.id))
  })

  it("405 桩：列表 PUT/PATCH/DELETE、详情 PUT/DELETE、预览 GET", async () => {
    expect((await route.PUT()).status).toBe(405)
    expect((await route.PATCH()).status).toBe(405)
    expect((await route.DELETE()).status).toBe(405)
    expect((await detailRoute.PUT()).status).toBe(405)
    expect((await detailRoute.DELETE()).status).toBe(405)
    const previewRoute = await import("../../src/app/api/admin/v1/imports/preview/route.ts")
    expect((await previewRoute.GET()).status).toBe(405)
  })
})
