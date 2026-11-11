// /api/admin/v1/tags/[id] —— GET 详情 / PATCH 更新 / DELETE 软删除（?version=）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateTagSchema } from "@/lib/admin/validation/tag-schema.ts"
import { deleteTag, getTag, updateTag } from "@/lib/admin/services/tag-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

async function routeId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params
  const parsed = bigintIdSchema.safeParse(id)
  if (!parsed.success) throw zodFieldError(parsed.error)
  return parsed.data
}

export async function GET(req: Request, ctx: Ctx) {
  return handleRead(req, "tags.read", "admin tag get", async () => {
    const id = await routeId(ctx.params)
    return getTag(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(req, "tags.update", "admin tag update", updateTagSchema, async (_admin, wctx, body) => {
    const id = await routeId(ctx.params)
    return updateTag(wctx, id, body)
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "tags.delete", "admin tag delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteTag(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
