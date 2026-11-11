// /api/admin/v1/bulletins/[id] —— GET 详情（含软删除行）/ PATCH 编辑（乐观锁，无 status）/ DELETE 软删除（?version=）
import { handleRead, handleWrite, methodNotAllowed, MAX_BODY_BYTES_RICH } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateBulletinSchema } from "@/lib/admin/validation/bulletin-schema.ts"
import { deleteBulletin, getBulletin, updateBulletin } from "@/lib/admin/services/bulletin-service.ts"

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
  return handleRead(req, "bulletins.read", "admin bulletin get", async () => {
    const id = await routeId(ctx.params)
    return getBulletin(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(
    req,
    "bulletins.update",
    "admin bulletin update",
    updateBulletinSchema,
    async (_admin, wctx, body) => {
      const id = await routeId(ctx.params)
      return updateBulletin(wctx, id, body)
    },
    { maxBytes: MAX_BODY_BYTES_RICH },
  )
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "bulletins.delete", "admin bulletin delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteBulletin(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
