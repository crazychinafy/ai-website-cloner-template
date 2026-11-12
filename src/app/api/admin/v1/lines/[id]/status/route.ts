// PATCH /api/admin/v1/lines/[id]/status —— 启停（lines.update；审计 line.enable / line.disable）
// active ↔ disabled；同态 → 422 LINE_STATUS_TRANSITION
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { lineStatusChangeSchema } from "@/lib/admin/validation/line-schema.ts"
import { changeLineStatus } from "@/lib/admin/services/line-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(req, "lines.update", "admin line status", lineStatusChangeSchema, async (_admin, wctx, body) => {
    const { id } = await ctx.params
    const parsedId = bigintIdSchema.safeParse(id)
    if (!parsedId.success) throw zodFieldError(parsedId.error)
    return changeLineStatus(wctx, parsedId.data, body)
  })
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
