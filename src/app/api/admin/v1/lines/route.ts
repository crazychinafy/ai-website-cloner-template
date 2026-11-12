// GET  /api/admin/v1/lines —— 线路列表（分页 + q(名称)/status/includeDeleted + 白名单排序，默认 sortOrder asc）
// POST /api/admin/v1/lines —— 新建线路（恒 disabled、version=1；Service 事务 + 审计）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { createLineSchema, lineListQuerySchema } from "@/lib/admin/validation/line-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createLine, listLines } from "@/lib/admin/services/line-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "lines.read", "admin lines list", () => {
    const parsed = lineListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listLines(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "lines.create", "admin lines create", createLineSchema, (_admin, ctx, body) => createLine(ctx, body))
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
