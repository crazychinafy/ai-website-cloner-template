// GET  /api/admin/v1/tags —— 标签列表
// POST /api/admin/v1/tags —— 新建（颜色 HEX 校验，保存统一小写）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { createTagSchema, tagListQuerySchema } from "@/lib/admin/validation/tag-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createTag, listTags } from "@/lib/admin/services/tag-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "tags.read", "admin tags list", () => {
    const parsed = tagListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listTags(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "tags.create", "admin tags create", createTagSchema, (_admin, ctx, body) => createTag(ctx, body))
}

export async function PUT() {
  return methodNotAllowed("GET, POST, PATCH")
}
