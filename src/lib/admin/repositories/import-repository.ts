// P7：导入管理 Repository（13 内容表只读快照 + admin_import_runs 历史）
// ─────────────────────────────────────────────────────────────────
// - readContentRows 只做 selectAll（预览零写入合同的一部分；写路径全部在 core 内）
// - 历史列表 leftJoin adminUsers（started_by）；用户已删除时不丢行
import "server-only"
import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import {
  adminImportRuns,
  adminUsers,
  ads,
  articleCategories,
  articles,
  bulletins,
  iconLibraries,
  linkCategories,
  siteLinkDetails,
  siteLinkMirrors,
  siteLinks,
  siteLines,
  sitePages,
  siteSettings,
  siteTags,
} from "@/lib/db/schema"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { likeEscape } from "../validation/list-query.ts"
import type { ImportRunListQuery } from "../validation/import-schema.ts"
import type { Rec } from "../import/import-compare.ts"

/** 13 张内容表（与 core CONTENT_TABLES 同序）；id → drizzle 表对象 */
export const DB_CONTENT_TABLES = {
  link_categories: linkCategories,
  article_categories: articleCategories,
  site_tags: siteTags,
  site_links: siteLinks,
  site_link_details: siteLinkDetails,
  site_link_mirrors: siteLinkMirrors,
  articles,
  bulletins,
  ads,
  site_lines: siteLines,
  site_pages: sitePages,
  icon_libraries: iconLibraries,
  site_settings: siteSettings,
} as const

export type ContentTableId = keyof typeof DB_CONTENT_TABLES

/** 全量读取 13 张内容表当前行（预览用；返回平面对象，交给 import-compare 投影） */
export async function readContentRows(db: AdminDb = getDrizzle()): Promise<Record<ContentTableId, Rec[]>> {
  const ids = Object.keys(DB_CONTENT_TABLES) as ContentTableId[]
  const results = await Promise.all(ids.map((id) => db.select().from(DB_CONTENT_TABLES[id])))
  const out = {} as Record<ContentTableId, Rec[]>
  ids.forEach((id, i) => {
    out[id] = results[i] as unknown as Rec[]
  })
  return out
}

export interface ImportRunJoinedRow {
  run: typeof adminImportRuns.$inferSelect
  startedByUsername: string | null
}

function buildRunWhere(q: ImportRunListQuery): SQL | undefined {
  const conds: (SQL | undefined)[] = []
  if (q.q) {
    const t = `%${likeEscape(q.q)}%`
    conds.push(or(like(adminImportRuns.snapshotVersion, t), like(adminImportRuns.checksum, t)))
  }
  if (q.mode) conds.push(eq(adminImportRuns.mode, q.mode))
  if (q.status) conds.push(eq(adminImportRuns.status, q.status))
  if (q.snapshotVersion) conds.push(eq(adminImportRuns.snapshotVersion, q.snapshotVersion))
  if (q.startDate) conds.push(gte(adminImportRuns.startedAt, `${q.startDate} 00:00:00`))
  if (q.endDate) conds.push(lte(adminImportRuns.startedAt, `${q.endDate} 23:59:59.999`))
  return conds.length > 0 ? and(...conds) : undefined
}

export async function listImportRuns(
  q: ImportRunListQuery,
  db: AdminDb = getDrizzle(),
): Promise<{ rows: ImportRunJoinedRow[]; total: number }> {
  const where = buildRunWhere(q)
  const primary = q.sortBy === "id" ? adminImportRuns.id : adminImportRuns.startedAt
  const offset = (q.page - 1) * q.pageSize
  const [rows, countRows] = await Promise.all([
    db
      .select({ run: adminImportRuns, startedByUsername: adminUsers.username })
      .from(adminImportRuns)
      .leftJoin(adminUsers, eq(adminImportRuns.startedBy, adminUsers.id))
      .where(where)
      .orderBy(
        q.sortDir === "asc" ? asc(primary) : desc(primary),
        q.sortBy === "id" && q.sortDir === "asc" ? asc(adminImportRuns.id) : desc(adminImportRuns.id),
      )
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(adminImportRuns)
      .leftJoin(adminUsers, eq(adminImportRuns.startedBy, adminUsers.id))
      .where(where),
  ])
  return { rows, total: Number(countRows[0]?.total ?? 0) }
}

export async function getImportRunById(
  id: string,
  db: AdminDb = getDrizzle(),
): Promise<ImportRunJoinedRow | null> {
  const rows = await db
    .select({ run: adminImportRuns, startedByUsername: adminUsers.username })
    .from(adminImportRuns)
    .leftJoin(adminUsers, eq(adminImportRuns.startedBy, adminUsers.id))
    .where(eq(adminImportRuns.id, BigInt(id)))
    .limit(1)
  return rows[0] ?? null
}
