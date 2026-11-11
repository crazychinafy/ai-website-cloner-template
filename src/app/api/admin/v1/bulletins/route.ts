// GET  /api/admin/v1/bulletins —— 公告列表（分页 + q(标题)/status/includeDeleted + 排序白名单，默认 sortOrder asc）
// POST /api/admin/v1/bulletins —— 新建公告（恒 draft；sortOrder 省略=追加末尾；正文 Service 净化 + 审计）
import { handleRead, handleWrite, methodNotAllowed, MAX_BODY_BYTES_RICH } from "@/lib/admin/api/handler.ts"
import { bulletinListQuerySchema, createBulletinSchema } from "@/lib/admin/validation/bulletin-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createBulletin, listBulletins } from "@/lib/admin/services/bulletin-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "bulletins.read", "admin bulletins list", () => {
    const parsed = bulletinListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listBulletins(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(
    req,
    "bulletins.create",
    "admin bulletins create",
    createBulletinSchema,
    (_admin, ctx, body) => createBulletin(ctx, body),
    { maxBytes: MAX_BODY_BYTES_RICH },
  )
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
