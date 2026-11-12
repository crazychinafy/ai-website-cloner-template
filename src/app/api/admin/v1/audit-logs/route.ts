// GET /api/admin/v1/audit-logs —— 审计日志列表（audit_logs.read；只读，无写方法）
// 过滤：q / actorUserId / action / resourceType / resourceId / requestId / startDate / endDate
// 排序：createdAt|id 白名单，默认 createdAt DESC + id DESC；分页 20/50/100
import { handleRead, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { auditListQuerySchema } from "@/lib/admin/validation/audit-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { listAuditLogs } from "@/lib/admin/services/audit-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "audit_logs.read", "admin audit-logs list", () => {
    const parsed = auditListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listAuditLogs(parsed.data)
  })
}

export async function POST() {
  return methodNotAllowed("GET")
}
export async function PUT() {
  return methodNotAllowed("GET")
}
export async function PATCH() {
  return methodNotAllowed("GET")
}
export async function DELETE() {
  return methodNotAllowed("GET")
}
