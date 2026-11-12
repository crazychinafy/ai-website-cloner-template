// P7：导入管理 Service（预览零写入 / 执行安全门 / 历史只读）
// ─────────────────────────────────────────────────────────────────
// 复用 P4 核心（static-import-core.ts + import-compare.ts），不存在第二套导入实现：
//   - 预览 = core dry-run（SELECT only：无 INSERT/UPDATE/DELETE、不写 admin_import_runs、不写审计）
//   - 执行 = runStaticImport(execute) + P7 安全门：
//       Session + CSRF + imports.execute（路由层）
//       → 预览回执校验（snapshotVersion + checksum 与服务端现值一致，客户端不可覆盖）
//       → 二次确认（confirmDatabase 手输 = 服务端库名，精确匹配）
//       → 生产双因子（confirmProduction + ADMIN_IMPORT_ALLOW_PRODUCTION=1）
//       → MySQL GET_LOCK 命名锁（跨进程互斥；进程崩溃由服务端自动释放；拿不到 → 409）
//       → P4 内置条件（首次导入 / 同版本同 checksum no-op / 非空拒绝）
//   - 成功审计写入在内容事务内（审计失败 → 内容回滚）；no-op 审计独立补记（引用历史 run ID，不假装没发生）
import "server-only"
import mysql from "mysql2/promise"
import { and, desc, eq } from "drizzle-orm"
import { adminImportRuns } from "@/lib/db/schema"
import { getDrizzle } from "@/lib/db/client"
import { getAdminEnv } from "../validation/env.ts"
import { ContentError } from "../validation/content-error.ts"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { redactErrorText } from "../audit/redactor.ts"
import type { AdminTx } from "../repositories/executor.ts"
import { pageResult } from "../dto/content.ts"
import type { PageResult } from "../dto/content.ts"
import type { ImportExecuteDto, ImportPreviewDto, ImportRunDto, ImportTableDiffDto } from "../dto/import.ts"
import type { ImportExecuteInput, ImportRunListQuery } from "../validation/import-schema.ts"
import * as repo from "../repositories/import-repository.ts"
import {
  buildStaticSnapshot,
  computeChecksum,
  runStaticImport,
  type ImportCreds,
  type StaticSnapshot,
} from "../import/static-import-core.ts"
import { IMPORT_TABLE_SPECS, computeTableDiff, type Rec, type RelationSets } from "../import/import-compare.ts"

/** 后台 Web 导入使用的快照版本（= 快照存档日；服务端唯一可信来源，客户端不可指定） */
export function webSnapshotVersion(snapshot: StaticSnapshot): string {
  return snapshot.archiveDate
}

export function serverImportCreds(): ImportCreds {
  const env = getAdminEnv()
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    poolSize: env.DB_POOL_SIZE,
  }
}

export function productionImportEnvAuthorized(): boolean {
  return process.env.ADMIN_IMPORT_ALLOW_PRODUCTION === "1"
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production"
}

// ── 历史 ──────────────────────────────────────────────────────────

export function toImportRunDto(row: repo.ImportRunJoinedRow): ImportRunDto {
  const run = row.run
  const startedBy = run.startedBy?.toString() ?? null
  let summary: ImportRunDto["summary"] = null
  if (run.summaryJson != null) {
    // drizzle json 列通常已解析；字符串形态防御性解一层；解不动 → null（不阻塞列表）
    try {
      const s = typeof run.summaryJson === "string" ? JSON.parse(run.summaryJson) : run.summaryJson
      summary = (s ?? null) as ImportRunDto["summary"]
    } catch {
      summary = null
    }
  }
  return {
    id: run.id.toString(),
    snapshotVersion: run.snapshotVersion,
    mode: run.mode,
    status: run.status,
    checksum: run.checksum ?? null,
    startedBy,
    startedByUsername: row.startedByUsername,
    startedByDeleted: startedBy !== null && row.startedByUsername === null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    // 读取时脱敏兜底（错误文本可能夹带连接串/凭据）；上限 2000 字符
    errorSummary: run.errorSummary != null ? redactErrorText(run.errorSummary) : null,
    summary,
  }
}

export async function listImportRuns(
  query: ImportRunListQuery,
  db = getDrizzle(),
): Promise<PageResult<ImportRunDto>> {
  const { rows, total } = await repo.listImportRuns(query, db)
  return pageResult(rows.map(toImportRunDto), total, query.page, query.pageSize)
}

export async function getImportRun(id: string): Promise<ImportRunDto> {
  const row = await repo.getImportRunById(id)
  if (!row) throw new ContentError(404, "IMPORT_RUN_NOT_FOUND", "导入记录不存在")
  return toImportRunDto(row)
}

/** 同版本最近一次成功导入（预览展示 + no-op 预期提示） */
async function findPriorSucceeded(
  snapshotVersion: string,
  db = getDrizzle(),
): Promise<{ id: string; checksum: string; startedAt: string } | null> {
  const rows = await db
    .select({ id: adminImportRuns.id, checksum: adminImportRuns.checksum, startedAt: adminImportRuns.startedAt })
    .from(adminImportRuns)
    .where(and(eq(adminImportRuns.snapshotVersion, snapshotVersion), eq(adminImportRuns.status, "succeeded")))
    .orderBy(desc(adminImportRuns.id))
    .limit(1)
  const r = rows[0]
  if (!r || !r.checksum || !r.startedAt) return null
  return { id: r.id.toString(), checksum: r.checksum, startedAt: r.startedAt }
}

// ── 预览（零写入） ────────────────────────────────────────────────

export interface PreviewOutcome {
  snapshotVersion: string
  checksum: string
  snapshot: StaticSnapshot
  /** core dry-run 结论：planned | no_op | refused */
  coreOutcome: "planned" | "no_op" | "refused"
  coreError: string | null
}

/** 执行 core 的 dry-run 并返回结构化结论（预览/执行回执共用；同一实现） */
export async function coreDryRun(snapshotVersion: string, snapshot?: StaticSnapshot): Promise<PreviewOutcome> {
  const snap = snapshot ?? buildStaticSnapshot()
  const result = await runStaticImport(serverImportCreds(), {
    snapshotVersion,
    execute: false,
    snapshot: snap,
  })
  return {
    snapshotVersion,
    checksum: result.checksum,
    snapshot: snap,
    coreOutcome: result.outcome === "no_op" ? "no_op" : result.outcome === "refused" ? "refused" : "planned",
    coreError: result.outcome === "refused" ? (result.error ?? "未知拒绝原因") : null,
  }
}

function snapshotRowsFor(snap: StaticSnapshot, tableId: string): Rec[] {
  const map: Record<string, unknown[]> = {
    link_categories: snap.linkCategories,
    article_categories: snap.articleCategories,
    site_tags: snap.siteTags,
    site_links: snap.siteLinks,
    site_link_details: snap.siteLinkDetails,
    site_link_mirrors: snap.siteLinkMirrors,
    articles: snap.articles,
    bulletins: snap.bulletins,
    ads: snap.ads,
    site_lines: snap.siteLines,
    site_pages: snap.sitePages,
    icon_libraries: snap.iconLibraries,
    site_settings: snap.siteSettings,
  }
  return map[tableId] as Rec[]
}

/**
 * 关联校验集合 = DB 键 ∪ 快照键。
 * 语义：关系错误只报告「真实的悬挂引用」（父级在两边都不存在）；
 * 若只取 DB 键，空库预览会把快照全部子级行误报为关系错误（快照内部自洽）。
 */
function buildRelationSets(snapshot: StaticSnapshot, dbRows: Record<repo.ContentTableId, Rec[]>): RelationSets {
  const specFor = (id: string) => IMPORT_TABLE_SPECS.find((s) => s.id === id)!
  const unionKeys = (id: "link_categories" | "article_categories" | "site_tags" | "site_links") =>
    new Set<string>([
      ...dbRows[id].map((r) => specFor(id).dbProject(r).key),
      ...snapshotRowsFor(snapshot, id).map((r) => specFor(id).snapProject(r).key),
    ])
  return {
    link_categories: unionKeys("link_categories"),
    article_categories: unionKeys("article_categories"),
    site_tags: unionKeys("site_tags"),
    site_links: unionKeys("site_links"),
  }
}

/**
 * 导入差异预览（只读）。
 * 合同：整条链路零写入 —— core dry-run 只执行 SELECT；此处也不写 runs / audit。
 */
export async function previewImport(): Promise<ImportPreviewDto> {
  const credsForPreview = serverImportCreds()
  const snapshot = buildStaticSnapshot()
  const snapshotVersion = webSnapshotVersion(snapshot)
  const dry = await coreDryRun(snapshotVersion, snapshot)

  const dbRows = await repo.readContentRows()
  const sets = buildRelationSets(snapshot, dbRows)
  const tables: ImportTableDiffDto[] = IMPORT_TABLE_SPECS.map((spec) =>
    computeTableDiff(spec, snapshotRowsFor(snapshot, spec.id), dbRows[spec.id as repo.ContentTableId], sets),
  )

  const dbTotal = tables.reduce((a, t) => a + t.dbCount, 0)
  const snapshotTotal = tables.reduce((a, t) => a + t.snapshotCount, 0)
  const prior = await findPriorSucceeded(snapshotVersion)
  const noOpMatched = prior !== null && prior.checksum === dry.checksum
  const blockedReason = dry.coreOutcome === "refused" ? dry.coreError : null

  return {
    snapshotVersion,
    checksum: dry.checksum,
    targetDatabase: credsForPreview.database,
    snapshotTotal,
    dbTotal,
    dbState: dbTotal === 0 ? "empty" : "populated",
    executable: dry.coreOutcome !== "refused",
    blockedReason,
    priorSucceeded: prior,
    noOpMatched,
    productionAllowed: productionImportEnvAuthorized(),
    isProduction: isProductionRuntime(),
    tables,
    anyTruncated: tables.some((t) => t.truncated),
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  }
}

// ── 执行 ──────────────────────────────────────────────────────────

/** GET_LOCK 名称（含库名 → 不同库互不阻塞；同库跨进程互斥） */
export function importLockName(database: string): string {
  return `facai8_import_${database}`.slice(0, 64)
}

async function acquireImportLock(creds: ImportCreds): Promise<mysql.Connection | null> {
  const conn = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.user,
    password: creds.password,
    database: creds.database,
  })
  try {
    const [rows] = (await conn.query(`SELECT GET_LOCK(?, 0) AS got`, [importLockName(creds.database)])) as unknown as [
      Array<{ got: number | string }>,
    ]
    if (Number(rows[0]?.got ?? 0) !== 1) {
      await conn.end()
      return null
    }
    return conn
  } catch (e) {
    await conn.end().catch(() => {})
    throw e
  }
}

async function releaseImportLock(conn: mysql.Connection, database: string): Promise<void> {
  try {
    await conn.query(`SELECT RELEASE_LOCK(?)`, [importLockName(database)])
  } catch {
    // 连接已断 → 锁由 MySQL 服务端随连接自动释放
  }
  await conn.end().catch(() => {})
}

/**
 * 执行导入（POST /imports；路由层已保证 Session + CSRF + imports.execute）。
 * 安全门顺序见文件头注释；任何不通过都抛出 ContentError（统一信封）。
 */
export async function executeImport(body: ImportExecuteInput, ctx: WriteCtx): Promise<ImportExecuteDto> {
  const creds = serverImportCreds()
  const snapshot = buildStaticSnapshot()
  const serverVersion = webSnapshotVersion(snapshot)
  const serverChecksum = computeChecksum(snapshot)

  // 预览回执校验：版本与校验和都必须是服务端现值（客户端不能指定/覆盖）
  if (body.snapshotVersion !== serverVersion) {
    throw new ContentError(
      409,
      "IMPORT_VERSION_MISMATCH",
      `快照版本已过期（服务端当前为 ${serverVersion}，请求为 ${body.snapshotVersion}），请重新预览`,
    )
  }
  if (body.checksum !== serverChecksum) {
    throw new ContentError(409, "IMPORT_CHECKSUM_MISMATCH", "快照校验和与服务端当前快照不一致，请重新预览后再执行")
  }

  // 二次确认：手输库名与服务端连接配置库名精确一致（core 还会对实际连接库名二次校验）
  if (!body.confirmDatabase || body.confirmDatabase !== creds.database) {
    throw new ContentError(422, "IMPORT_DB_NAME_MISMATCH", "二次确认的数据库名与服务器当前库名不一致")
  }

  // 生产双因子（路由/服务层先行给出精确错误码；core 内部还会兜底拒绝）
  if (isProductionRuntime()) {
    if (!body.confirmProduction) {
      throw new ContentError(409, "IMPORT_CONFIRM_REQUIRED", "生产环境导入需勾选生产环境确认")
    }
    if (!productionImportEnvAuthorized()) {
      throw new ContentError(409, "IMPORT_PROD_DISABLED", "生产环境导入未授权（需 ADMIN_IMPORT_ALLOW_PRODUCTION=1）")
    }
  }

  // 命名锁：跨进程互斥（页面 + CLI 同锁）；进程崩溃 → 连接断开由服务端自动释放
  const lock = await acquireImportLock(creds)
  if (!lock) {
    throw new ContentError(409, "IMPORT_LOCKED", "已有导入任务正在执行（或异常未释放），请稍后重试")
  }

  let result: Awaited<ReturnType<typeof runStaticImport>>
  try {
    result = await runStaticImport(creds, {
      snapshotVersion: serverVersion,
      execute: true,
      confirmDatabase: creds.database,
      allowProduction: body.confirmProduction,
      productionEnvAuthorized: productionImportEnvAuthorized(),
      snapshot,
      startedBy: ctx.actorUserId,
      // 成功审计在内容事务内：审计失败 → 内容写入整体回滚（不允许「假成功」）
      onContentInserted: async ({ tx, runId, counts }) => {
        await writeAudit(tx as unknown as AdminTx, ctx, {
          action: "import.execute",
          resourceType: "import_run",
          resourceId: runId,
          before: null,
          after: {
            outcome: "imported",
            snapshot_version: serverVersion,
            checksum: serverChecksum,
            total: Object.values(counts).reduce((a, b) => a + b, 0),
          },
        })
      },
    })
  } finally {
    await releaseImportLock(lock, creds.database)
  }

  if (result.outcome === "refused") {
    throw new ContentError(409, "IMPORT_REFUSED", `导入被拒绝：${result.error ?? "未知原因"}`)
  }
  if (result.outcome === "rolled_back" || result.outcome === "error") {
    throw new ContentError(500, "IMPORT_FAILED", `导入失败已回滚（${redactErrorText(result.error ?? "执行异常", 500)}）`)
  }

  if (result.outcome === "no_op") {
    // no-op：P4 语义不写 run 行；审计独立补记并引用命中的历史成功记录（不能假装没发生）
    const noOpRunId = result.noOpRunId ?? null
    const db = getDrizzle()
    await writeAudit(db as unknown as AdminTx, ctx, {
      action: "import.execute",
      resourceType: "import_run",
      resourceId: noOpRunId ?? "0",
      before: null,
      after: {
        outcome: "no_op",
        snapshot_version: serverVersion,
        checksum: serverChecksum,
        matched_run_id: noOpRunId,
      },
    })
    return {
      outcome: "no_op",
      runId: null,
      noOpRunId,
      snapshotVersion: serverVersion,
      checksum: serverChecksum,
      counts: null,
      total: 0,
      message:
        noOpRunId != null
          ? `安全 no-op：该快照已成功导入过（历史记录 #${noOpRunId}），未重复写入`
          : "安全 no-op：该快照已成功导入过，未重复写入",
    }
  }

  // imported
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0)
  return {
    outcome: "imported",
    runId: result.runId ?? null,
    noOpRunId: null,
    snapshotVersion: serverVersion,
    checksum: serverChecksum,
    counts: result.counts,
    total,
    message: `导入成功：${total} 行 / 13 表（导入记录 #${result.runId ?? "?"}）`,
  }
}
