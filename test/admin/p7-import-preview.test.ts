// P7：导入差异预览（POST /api/admin/v1/imports/preview）
// ─────────────────────────────────────────────────────────────────
// 合同断言：
//   1) 权限：imports.preview（auditor 200 / content_admin 403）+ CSRF + 401
//   2) 零写入：预览前后 admin_import_runs 与 admin_audit_logs 行数完全不变
//   3) 服务端可信 DTO：snapshotVersion/checksum 为服务端现值（快照常量）；
//      targetDatabase = 服务端连接库名（scratch）；客户端 body 完全被忽略
//   4) 空库形态：dbState=empty / executable=true / relationErrorTotal=0 /
//      每表 missingTotal=snapshotCount；大表差异列表按上限 100 截断（anyTruncated）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  P7_SCRATCH,
  auditRows,
  countRows,
  errBody,
  okBody,
  p7Login,
  reqFor,
  setupP7Env,
  teardownP7Env,
  type P7Env,
  type P7Session,
} from "./p7-harness.ts"
import type { ImportPreviewDto } from "../../src/lib/admin/dto/import.ts"

// 快照常量（与 src/lib/facai8/data 存档一致；前端冻结 ⇒ 这两值永不漂移）
const SNAPSHOT_VERSION = "2026-11-08"
const SNAPSHOT_CHECKSUM = "251537562d12b44c739e108471719eb4b99693141294d2656d7a09ff023e915f"

let env: P7Env
let auditor: P7Session
let contentAdmin: P7Session
let route: typeof import("../../src/app/api/admin/v1/imports/preview/route.ts")

const PREVIEW_PATH = "/api/admin/v1/imports/preview"

async function previewAs(session: P7Session, body: unknown = {}): Promise<Response> {
  return route.POST(reqFor(session, "POST", PREVIEW_PATH, body))
}

beforeAll(async () => {
  env = await setupP7Env()
  route = await import("../../src/app/api/admin/v1/imports/preview/route.ts")
  auditor = await p7Login(env, "p7prev_auditor", ["auditor"])
  contentAdmin = await p7Login(env, "p7prev_content", ["content_admin"])
}, 180_000)

afterAll(async () => {
  await teardownP7Env(env)
})

describe("导入预览：权限与只读合同", () => {
  it("未登录 → 401", async () => {
    const res = await route.POST(reqFor(auditor, "POST", PREVIEW_PATH, {}, { noAuth: true }))
    expect(res.status).toBe(401)
  })

  it("缺 CSRF → 403（预览也要写防护：POST + 会话 + CSRF）", async () => {
    const res = await route.POST(reqFor(auditor, "POST", PREVIEW_PATH, {}, { noCsrf: true }))
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("CSRF_INVALID")
  })

  it("无 imports.preview 权限（content_admin）→ 403", async () => {
    const res = await previewAs(contentAdmin)
    expect(res.status).toBe(403)
  })

  it("GET → 405（预览是 POST-only）", async () => {
    const res = await route.GET()
    expect(res.status).toBe(405)
  })

  it("auditor（imports.preview）→ 200，服务端可信 DTO", async () => {
    const res = await previewAs(auditor)
    expect(res.status).toBe(200)
    const { data } = await okBody<ImportPreviewDto>(res)
    // 版本与 checksum 是服务端现值，不是客户端回传值
    expect(data.snapshotVersion).toBe(SNAPSHOT_VERSION)
    expect(data.checksum).toBe(SNAPSHOT_CHECKSUM)
    expect(data.targetDatabase).toBe(P7_SCRATCH)
    expect(data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // 13 表齐全、顺序 = IMPORT_TABLE_SPECS
    expect(data.tables).toHaveLength(13)
    expect(data.tables.map((t) => t.tableId)).toContain("site_links")
    expect(data.snapshotTotal).toBeGreaterThan(4000)
    expect(data.isProduction).toBe(false)
    expect(data.productionAllowed).toBe(false)
  })

  it("客户端 body 被忽略：伪造 version/checksum 不改变服务端结论", async () => {
    const res = await previewAs(auditor, {
      snapshotVersion: "1999-01-01",
      checksum: "f".repeat(64),
      targetDatabase: "soucai8",
    })
    expect(res.status).toBe(200)
    const { data } = await okBody<ImportPreviewDto>(res)
    expect(data.snapshotVersion).toBe(SNAPSHOT_VERSION)
    expect(data.checksum).toBe(SNAPSHOT_CHECKSUM)
    expect(data.targetDatabase).toBe(P7_SCRATCH)
  })

  it("空库预览：empty / 可执行 / 关系错误 0 / 全表 missing / 大表列表按 100 截断", async () => {
    const res = await previewAs(auditor)
    const { data } = await okBody<ImportPreviewDto>(res)
    expect(data.dbTotal).toBe(0)
    expect(data.dbState).toBe("empty")
    expect(data.executable).toBe(true)
    expect(data.blockedReason).toBeNull()
    expect(data.priorSucceeded).toBeNull()
    expect(data.noOpMatched).toBe(false)
    let relationTotal = 0
    let missingTotal = 0
    for (const t of data.tables) {
      expect(t.dbCount).toBe(0)
      expect(t.extraTotal).toBe(0)
      expect(t.changedTotal).toBe(0)
      expect(t.relationErrorTotal).toBe(0) // 快照内部自洽 → 无悬挂引用
      // 集合不一致 → 不评估顺序（null）；两侧集合相同（皆空）→ false
      expect(t.orderChanged).toBe(t.missingTotal + t.extraTotal > 0 ? null : false)
      expect(t.missingTotal).toBe(t.snapshotCount)
      // 差异列表上限：最多 100 条明细，total 保留真实数
      expect(t.missing.length).toBeLessThanOrEqual(100)
      if (t.missingTotal > 100) expect(t.truncated).toBe(true)
      relationTotal += t.relationErrorTotal
      missingTotal += t.missingTotal
    }
    expect(relationTotal).toBe(0)
    expect(missingTotal).toBe(data.snapshotTotal)
    expect(data.anyTruncated).toBe(true) // site_links 3792 行 > 100 上限
    const links = data.tables.find((t) => t.tableId === "site_links")!
    expect(links.missingTotal).toBeGreaterThan(100)
    expect(links.missing).toHaveLength(100)
  })

  it("零写入合同：预览前后 runs / audit 行数一字不变（不写 runs、不写审计）", async () => {
    const runsBefore = await countRows(env.pool, "admin_import_runs")
    const auditBefore = await countRows(env.pool, "admin_audit_logs")
    expect((await previewAs(auditor)).status).toBe(200)
    expect((await previewAs(auditor)).status).toBe(200)
    expect(await countRows(env.pool, "admin_import_runs")).toBe(runsBefore)
    expect(await countRows(env.pool, "admin_audit_logs")).toBe(auditBefore)
    // 直读也确认：没有任何 dry_run 模式行被写入
    const dry = await auditRows(
      env.pool,
      " where resource_type = 'import_run' or action like 'import%'",
    )
    expect(dry).toHaveLength(0)
    const runRows = await countRows(env.pool, "admin_import_runs", "where mode = 'dry_run'")
    expect(runRows).toBe(0)
  })
})
