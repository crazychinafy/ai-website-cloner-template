// P7：审计日志 Service（只读；读取时脱敏兜底 + IP 解码 + 已删除管理员标注）
// ─────────────────────────────────────────────────────────────────
// - 读取时对 before/after 再跑一遍统一脱敏器（写入时机已脱敏；此处覆盖 P6 历史行 + 双保险）
// - 只改写 DTO，绝不回写数据库行
// - 本系统审计只有读接口：没有编辑/删除/清理入口（日志不可变）
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import * as repo from "../repositories/audit-repository.ts"
import { decodeIp } from "../audit/ip-decoder.ts"
import { redactAuditValue } from "../audit/redactor.ts"
import { pageResult } from "../dto/content.ts"
import type { PageResult } from "../dto/content.ts"
import type { AuditFilterOptionsDto, AuditLogDto } from "../dto/audit.ts"
import type { AuditListQuery } from "../validation/audit-schema.ts"

export function toAuditDto(row: repo.AuditJoinedRow): AuditLogDto {
  const actorUserId = row.log.actorUserId?.toString() ?? null
  return {
    id: row.log.id.toString(),
    actorUserId,
    actorUsername: row.actorUsername,
    // 有操作人 ID 但 JOIN 不到用户名 = 账号已被物理删除
    actorDeleted: actorUserId !== null && row.actorUsername === null,
    action: row.log.action,
    resourceType: row.log.resourceType,
    resourceId: row.log.resourceId ?? null,
    before: redactAuditValue(row.log.beforeJson ?? null),
    after: redactAuditValue(row.log.afterJson ?? null),
    requestId: row.log.requestId ?? null,
    // IP 由 repository 以 hex(ip_address) 读取（见 audit-repository 注释；decodeIp 认 hex 字符串）
    ipAddress: decodeIp(row.ipHex),
    userAgent: row.log.userAgent ?? null,
    createdAt: row.log.createdAt,
  }
}

export async function listAuditLogs(
  query: AuditListQuery,
  db: AdminDb = getDrizzle(),
): Promise<PageResult<AuditLogDto>> {
  const { rows, total } = await repo.listAuditLogs(query, db)
  return pageResult(rows.map(toAuditDto), total, query.page, query.pageSize)
}

export async function getAuditFilterOptions(db: AdminDb = getDrizzle()): Promise<AuditFilterOptionsDto> {
  return repo.getAuditFilterOptions(db)
}
