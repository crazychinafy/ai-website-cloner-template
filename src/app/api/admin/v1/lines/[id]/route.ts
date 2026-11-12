// /api/admin/v1/lines/[id] —— GET 详情（含软删除行）/ PATCH 编辑（乐观锁，无 status）/ DELETE 软删除（?version=）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateLineSchema } from "@/lib/admin/validation/line-schema.ts"
import { deleteLine, getLine, updateLine } from "@/lib/admin/services/line-service.ts"

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
  return handleRead(req, "lines.read", "admin line get", async () => {
    const id = await routeId(ctx.params)
    return getLine(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(req, "lines.update", "admin line update", updateLineSchema, async (_admin, wctx, body) => {
    const id = await routeId(ctx.params)
    return updateLine(wctx, id, body)
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "lines.delete", "admin line delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteLine(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
