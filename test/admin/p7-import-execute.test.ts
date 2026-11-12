// P7：导入执行（POST /api/admin/v1/imports）
// ─────────────────────────────────────────────────────────────────
// 安全门顺序与错误码合同：
//   imports.execute 权限 → CSRF → 预览回执（版本 409 → checksum 409）
//   → confirmDatabase 422 → 生产双因子 409/409 → GET_LOCK 409 IMPORT_LOCKED → P4 核心
// 执行结果合同：
//   imported：200 + runs 行（真实 started_by）+ 内容事务内审计 import.execute
//   no_op：200 不新增 runs 行；审计独立补记 matched_run_id（不假装没发生）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import mysql from "mysql2/promise"
import {
  P7_SCRATCH,
  auditRows,
  countRows,
  errBody,
  okBody,
  p7Login,
  parseJsonCol,
  rawQuery,
  reqFor,
  setupP7Env,
  teardownP7Env,
  type P7Env,
  type P7Session,
} from "./p7-harness.ts"
import { readCreds } from "./test-db.ts"
import { setNodeEnv } from "./test-admin.ts"
import type { ImportExecuteDto } from "../../src/lib/admin/dto/import.ts"

const SNAPSHOT_VERSION = "2026-11-08"
const SNAPSHOT_CHECKSUM = "251537562d12b44c739e108471719eb4b99693141294d2656d7a09ff023e915f"
const LOCK_NAME = `facai8_import_${P7_SCRATCH}`.slice(0, 64)

const POST_PATH = "/api/admin/v1/imports"

let env: P7Env
let superS: P7Session
let auditor: P7Session
let route: typeof import("../../src/app/api/admin/v1/imports/route.ts")

/** 合法执行体（可按门点覆盖单字段） */
function goodBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    checksum: SNAPSHOT_CHECKSUM,
    confirmDatabase: P7_SCRATCH,
    ...over,
  }
}

async function postImport(session: P7Session, body: unknown): Promise<Response> {
  return route.POST(reqFor(session, "POST", POST_PATH, body))
}

let savedNodeEnv: string | undefined

beforeAll(async () => {
  env = await setupP7Env()
  route = await import("../../src/app/api/admin/v1/imports/route.ts")
  superS = await p7Login(env, "p7exec_super", ["super_admin"])
  auditor = await p7Login(env, "p7exec_auditor", ["auditor"])
  savedNodeEnv = process.env.NODE_ENV
}, 180_000)

afterAll(async () => {
  setNodeEnv(savedNodeEnv)
  await teardownP7Env(env)
})

describe("导入执行：鉴权与校验门（全部零写入）", () => {
  it("未登录 → 401；无 imports.execute（auditor）→ 403；缺 CSRF → 403", async () => {
    const unauth = await route.POST(reqFor(superS, "POST", POST_PATH, goodBody(), { noAuth: true }))
    expect(unauth.status).toBe(401)
    const forbidden = await postImport(auditor, goodBody())
    expect(forbidden.status).toBe(403)
    const noCsrf = await route.POST(reqFor(superS, "POST", POST_PATH, goodBody(), { noCsrf: true }))
    expect(noCsrf.status).toBe(403)
    expect((await errBody(noCsrf)).error.code).toBe("CSRF_INVALID")
  })

  it("body 字段校验 → 422（缺字段 / checksum 非 64-hex）", async () => {
    const missing = await postImport(superS, {})
    expect(missing.status).toBe(422)
    const badSum = await postImport(superS, goodBody({ checksum: "XYZ" }))
    expect(badSum.status).toBe(422)
    expect((await errBody(badSum)).error.fields?.checksum).toBeTruthy()
  })

  it("预览回执过期：版本 409 优先于 checksum/dbname", async () => {
    const v = await postImport(superS, goodBody({ snapshotVersion: "2020-01-01", checksum: "a".repeat(64), confirmDatabase: "wrong_db" }))
    expect(v.status).toBe(409)
    expect((await errBody(v)).error.code).toBe("IMPORT_VERSION_MISMATCH")

    const c = await postImport(superS, goodBody({ checksum: "b".repeat(64), confirmDatabase: "wrong_db" }))
    expect(c.status).toBe(409)
    expect((await errBody(c)).error.code).toBe("IMPORT_CHECKSUM_MISMATCH")

    const d = await postImport(superS, goodBody({ confirmDatabase: "wrong_db" }))
    expect(d.status).toBe(422)
    expect((await errBody(d)).error.code).toBe("IMPORT_DB_NAME_MISMATCH")
  })

  it("生产双因子：confirmProduction 缺失 → 409；缺环境变量 → 409", async () => {
    setNodeEnv("production")
    try {
      const noConfirm = await postImport(superS, goodBody())
      expect(noConfirm.status).toBe(409)
      expect((await errBody(noConfirm)).error.code).toBe("IMPORT_CONFIRM_REQUIRED")

      const noEnv = await postImport(superS, goodBody({ confirmProduction: true }))
      expect(noEnv.status).toBe(409)
      expect((await errBody(noEnv)).error.code).toBe("IMPORT_PROD_DISABLED")
    } finally {
      setNodeEnv(savedNodeEnv)
    }
    // 非生产环境 confirmProduction 不需要
    expect(process.env.NODE_ENV).not.toBe("production")
  })

  it("跨进程互斥：外部连接持有 GET_LOCK → 409 IMPORT_LOCKED", async () => {
    const c = readCreds()
    const holder = await mysql.createConnection({
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: P7_SCRATCH,
    })
    try {
      const [rows] = (await holder.query("SELECT GET_LOCK(?, 0) AS got", [LOCK_NAME])) as unknown as [Array<{ got: number | string }>]
      expect(Number(rows[0]?.got)).toBe(1) // 锁名可用且已占有
      const res = await postImport(superS, goodBody())
      expect(res.status).toBe(409)
      expect((await errBody(res)).error.code).toBe("IMPORT_LOCKED")
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME])
      await holder.end()
    }
  })

  it("以上所有失败门都没有留下 runs / 内容行 / import 审计", async () => {
    expect(await countRows(env.pool, "admin_import_runs")).toBe(0)
    expect(await countRows(env.pool, "site_links")).toBe(0)
    const audits = await auditRows(env.pool, " where action = 'import.execute'")
    expect(audits).toHaveLength(0)
  })
})

describe("导入执行：成功导入与 no-op", () => {
  let runId: string

  it("合法执行 → 200 imported：DTO / runs 行（真实 started_by）/ 内容行数 / 事务内审计", async () => {
    const res = await postImport(superS, goodBody())
    expect(res.status).toBe(200)
    const { data } = await okBody<ImportExecuteDto>(res)
    expect(data.outcome).toBe("imported")
    expect(data.runId).toMatch(/^\d+$/)
    expect(data.noOpRunId).toBeNull()
    expect(data.snapshotVersion).toBe(SNAPSHOT_VERSION)
    expect(data.checksum).toBe(SNAPSHOT_CHECKSUM)
    expect(data.total).toBe(4182) // 快照总行数（13 表）
    runId = data.runId!
    expect(data.message).toContain(`#${runId}`)

    // 内容真的落了库：抽查关键表 + 总量
    expect(await countRows(env.pool, "site_links")).toBe(3791)
    const dbTotal =
      (await countRows(env.pool, "link_categories")) +
      (await countRows(env.pool, "article_categories")) +
      (await countRows(env.pool, "site_tags")) +
      (await countRows(env.pool, "site_links")) +
      (await countRows(env.pool, "site_link_details")) +
      (await countRows(env.pool, "site_link_mirrors")) +
      (await countRows(env.pool, "articles")) +
      (await countRows(env.pool, "bulletins")) +
      (await countRows(env.pool, "ads")) +
      (await countRows(env.pool, "site_lines")) +
      (await countRows(env.pool, "site_pages")) +
      (await countRows(env.pool, "icon_libraries")) +
      (await countRows(env.pool, "site_settings"))
    expect(dbTotal).toBe(4182)

    // runs 行：真实管理员 ID（不是 NULL）、import/succeeded、快照字段
    const runs = await rawQuery<Record<string, string | null>>(
      env.pool,
      `select id, snapshot_version, mode, status, checksum, started_by, summary_json,
              finished_at from admin_import_runs where id = ?`,
      [runId],
    )
    expect(runs).toHaveLength(1)
    const run = runs[0]!
    expect(run.mode).toBe("import")
    expect(run.status).toBe("succeeded")
    expect(run.snapshot_version).toBe(SNAPSHOT_VERSION)
    expect(run.checksum).toBe(SNAPSHOT_CHECKSUM)
    expect(String(run.started_by)).toBe(String(superS.admin.id)) // Web 触发 = 真实操作人
    expect(run.finished_at).not.toBeNull()
    const summary = parseJsonCol(run.summary_json) as { total?: number }
    expect(summary.total).toBe(4182)

    // 审计在内容事务内：恰好 1 条 import.execute，resource_id = runId，actor 真实
    const audits = await auditRows(env.pool, " where action = 'import.execute'")
    expect(audits).toHaveLength(1)
    expect(audits[0]!.resource_type).toBe("import_run")
    expect(audits[0]!.resource_id).toBe(runId)
    expect(String(audits[0]!.actor_user_id)).toBe(String(superS.admin.id))
    const after = parseJsonCol(audits[0]!.after_json) as { outcome?: string; total?: number }
    expect(after.outcome).toBe("imported")
    expect(after.total).toBe(4182)
  }, 180_000)

  it("再次执行 → 200 no_op：不新增 runs 行，审计引用命中的历史 run（不假装没发生）", async () => {
    const runsBefore = await countRows(env.pool, "admin_import_runs")
    const linksBefore = await countRows(env.pool, "site_links")
    const res = await postImport(superS, goodBody())
    expect(res.status).toBe(200)
    const { data } = await okBody<ImportExecuteDto>(res)
    expect(data.outcome).toBe("no_op")
    expect(data.runId).toBeNull()
    expect(data.noOpRunId).toBe(runId)
    expect(data.total).toBe(0)
    expect(data.message).toContain(`#${runId}`)

    expect(await countRows(env.pool, "admin_import_runs")).toBe(runsBefore)
    expect(await countRows(env.pool, "site_links")).toBe(linksBefore)

    const audits = await auditRows(env.pool, " where action = 'import.execute'")
    const last = audits[audits.length - 1]! // 辅助函数固定 order by id
    expect(audits).toHaveLength(2) // imported 一条 + no_op 一条
    const after = parseJsonCol(last.after_json) as { outcome?: string; matched_run_id?: string | null }
    expect(after.outcome).toBe("no_op")
    expect(after.matched_run_id).toBe(runId)
  }, 120_000)

  it("导入后预览：populated / noOpMatched=true / priorSucceeded 指向本次 run", async () => {
    const previewRoute = await import("../../src/app/api/admin/v1/imports/preview/route.ts")
    const res = await previewRoute.POST(reqFor(auditor, "POST", "/api/admin/v1/imports/preview", {}))
    expect(res.status).toBe(200)
    const { data } = await okBody<import("../../src/lib/admin/dto/import.ts").ImportPreviewDto>(res)
    expect(data.dbState).toBe("populated")
    expect(data.dbTotal).toBe(4182)
    expect(data.priorSucceeded?.id).toBe(runId)
    expect(data.noOpMatched).toBe(true)
    expect(data.executable).toBe(true)
    for (const t of data.tables) {
      expect(t.missingTotal).toBe(0)
      expect(t.extraTotal).toBe(0)
      expect(t.changedTotal).toBe(0)
      expect(t.relationErrorTotal).toBe(0)
    }
    expect(data.anyTruncated).toBe(false)
  }, 120_000)

  it("锁已释放：导入结束后外部连接可立即获得 GET_LOCK", async () => {
    const c = readCreds()
    const probe = await mysql.createConnection({
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: P7_SCRATCH,
    })
    try {
      const [rows] = (await probe.query("SELECT GET_LOCK(?, 0) AS got", [LOCK_NAME])) as unknown as [Array<{ got: number | string }>]
      expect(Number(rows[0]?.got)).toBe(1)
      await probe.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME])
    } finally {
      await probe.end()
    }
  })
})
