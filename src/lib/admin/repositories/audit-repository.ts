// P7：审计日志 Repository（admin_audit_logs 只读；绝不 UPDATE/DELETE —— 日志不可编辑/清理）
// ─────────────────────────────────────────────────────────────────
// - 操作人 leftJoin adminUsers：账号被物理删除时 SET NULL → 展示「已删除管理员」，日志行绝不丢失
// - 排序白名单 createdAt|id（服务端映射到列，绝不透传字符串进 SQL）；次级排序恒 id DESC
// - COUNT 与列表同一 JOIN（q 命中用户名时两者口径一致）
import "server-only"
import { and, asc, desc, eq, gte, like, lte, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { adminAuditLogs, adminUsers } from "@/lib/db/schema"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { likeEscape, toBigInt } from "../validation/list-query.ts"
import type { AuditListQuery } from "../validation/audit-schema.ts"

export interface AuditJoinedRow {
  log: typeof adminAuditLogs.$inferSelect
  actorUsername: string | null
  /** hex(ip_address)：VARBINARY 经 SQL hex() 取大写十六进制（8=IPv4 / 32=IPv6 / NULL） */
  ipHex: string | null
}

function buildWhere(q: AuditListQuery): SQL | undefined {
  const conds: (SQL | undefined)[] = []
  if (q.q) {
    const t = `%${likeEscape(q.q)}%`
    conds.push(or(like(adminAuditLogs.action, t), like(adminAuditLogs.resourceId, t), like(adminAuditLogs.requestId, t), like(adminUsers.username, t)))
  }
  if (q.actorUserId) conds.push(eq(adminAuditLogs.actorUserId, toBigInt(q.actorUserId)))
  if (q.action) conds.push(eq(adminAuditLogs.action, q.action))
  if (q.resourceType) conds.push(eq(adminAuditLogs.resourceType, q.resourceType))
  if (q.resourceId) conds.push(eq(adminAuditLogs.resourceId, q.resourceId))
  if (q.requestId) conds.push(eq(adminAuditLogs.requestId, q.requestId))
  // 日期边界（datetime 字符串模式；end 含当天 23:59:59.999）
  if (q.startDate) conds.push(gte(adminAuditLogs.createdAt, `${q.startDate} 00:00:00`))
  if (q.endDate) conds.push(lte(adminAuditLogs.createdAt, `${q.endDate} 23:59:59.999`))
  return conds.length > 0 ? and(...conds) : undefined
}

export async function listAuditLogs(
  q: AuditListQuery,
  db: AdminDb = getDrizzle(),
): Promise<{ rows: AuditJoinedRow[]; total: number }> {
  const where = buildWhere(q)
  const primary = q.sortBy === "id" ? adminAuditLogs.id : adminAuditLogs.createdAt
  const offset = (q.page - 1) * q.pageSize
  const [rows, countRows] = await Promise.all([
    db
      .select({
        log: adminAuditLogs,
        actorUsername: adminUsers.username,
        // VARBINARY 不直接回读：drizzle 查询级 typeCast 令 utf8mb4 连接按文本解码，
        // ≥0x80 字节被替换成 U+FFFD（不可逆）。hex() 在 MySQL 5.7/8.x 都可用。
        ipHex: sql<string | null>`hex(${adminAuditLogs.ipAddress})`,
      })
      .from(adminAuditLogs)
      .leftJoin(adminUsers, eq(adminAuditLogs.actorUserId, adminUsers.id))
      .where(where)
      .orderBy(
        q.sortDir === "asc" ? asc(primary) : desc(primary),
        // 次级排序恒 id DESC（同秒多条稳定分页）
        q.sortBy === "id" && q.sortDir === "asc" ? asc(adminAuditLogs.id) : desc(adminAuditLogs.id),
      )
      .limit(q.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(adminAuditLogs)
      .leftJoin(adminUsers, eq(adminAuditLogs.actorUserId, adminUsers.id))
      .where(where),
  ])
  return { rows, total: Number(countRows[0]?.total ?? 0) }
}

/** 筛选下拉的真实选项（DISTINCT 当前数据；各限 200，防止无界返回） */
export async function getAuditFilterOptions(
  db: AdminDb = getDrizzle(),
): Promise<{ actions: string[]; resourceTypes: string[]; actors: { id: string; username: string }[] }> {
  const [actions, resourceTypes, actors] = await Promise.all([
    db
      .selectDistinct({ v: adminAuditLogs.action })
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.action))
      .limit(200),
    db
      .selectDistinct({ v: adminAuditLogs.resourceType })
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.resourceType))
      .limit(200),
    db
      .select({ id: adminUsers.id, username: adminUsers.username })
      .from(adminUsers)
      .orderBy(asc(adminUsers.username))
      .limit(200),
  ])
  return {
    actions: actions.map((r) => r.v),
    resourceTypes: resourceTypes.map((r) => r.v),
    actors: actors.map((r) => ({ id: r.id.toString(), username: r.username })),
  }
}
