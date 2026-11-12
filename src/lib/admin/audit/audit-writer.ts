// P6A：统一审计写入（复用 P2 admin_audit_logs 表；P7 起：写入时脱敏 + 审计管理页面）
// ─────────────────────────────────────────────────────────────────
// - 必须在业务事务内调用（与业务写入同一 tx）→ 审计失败时业务写入一并回滚
// - before/after 只记录实际变化字段；不记录密码/Session/Cookie/CSRF Token
// - P7：before/after 一律经统一脱敏器（redactor.ts）后才允许落库（写入时机；读取时机再兜一层）
// - requestId / IP / User-Agent 来自当次请求上下文
import "server-only"
import { adminAuditLogs } from "@/lib/db/schema"
import { ipLiteral, resolveClientIp } from "@/lib/admin/auth/session.ts"
import type { AdminTx } from "@/lib/admin/repositories/executor.ts"
import { redactAuditValue } from "./redactor.ts"

/** 写操作请求上下文（Route Handler 组装后传入 Service） */
export interface WriteCtx {
  /** 管理员用户 ID（BIGINT 十进制字符串） */
  actorUserId: string
  requestId: string
  req: Request
}

export interface AuditEntry {
  /** 例如 category.create / tag.disable / article_category.soft_delete */
  action: string
  /** link_category | article_category | tag（§11 资源类型建议） */
  resourceType: string
  /** 单资源 ID；批量操作（reorder）用作用域标识 */
  resourceId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

/** 在事务内写一条审计。审计失败 = 整个事务回滚（不允许“假成功”） */
export async function writeAudit(tx: AdminTx, ctx: WriteCtx, entry: AuditEntry): Promise<void> {
  const ua = (ctx.req.headers.get("user-agent") ?? "").slice(0, 500)
  await tx.insert(adminAuditLogs).values({
    actorUserId: BigInt(ctx.actorUserId),
    action: entry.action.slice(0, 100),
    resourceType: entry.resourceType.slice(0, 100),
    resourceId: entry.resourceId.slice(0, 100),
    beforeJson: entry.before != null ? (redactAuditValue(entry.before) as object | null) : null,
    afterJson: entry.after != null ? (redactAuditValue(entry.after) as object | null) : null,
    requestId: ctx.requestId.slice(0, 64),
    ipAddress: ipLiteral(resolveClientIp(ctx.req)),
    userAgent: ua || null,
  })
}

/** 值快照（进 before/after JSON；bigint/Date → 字符串，防 JSON 序列化失真） */
export function auditValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === "bigint") return v.toString()
  return v
}
