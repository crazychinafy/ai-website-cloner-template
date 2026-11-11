// GET  /api/admin/v1/links —— 网址列表（分页 + q/status/categoryId/tagId/includeDeleted + 排序白名单）
// POST /api/admin/v1/links —— 新建网址（恒 draft；聚合 body 可带 detail/mirrors；Service 做校验+净化+审计）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { createLinkSchema, linkListQuerySchema } from "@/lib/admin/validation/link-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createLink, listLinks } from "@/lib/admin/services/link-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "links.read", "admin links list", () => {
    const parsed = linkListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listLinks(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "links.create", "admin links create", createLinkSchema, (_admin, ctx, body) => createLink(ctx, body))
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
