// PATCH /api/admin/v1/ads/[id]/status —— 投放状态机（ads.update；审计 ad.enable / ad.disable / ad.expire）
// draft→active|expired / active→disabled|expired / disabled→active|expired / expired→active|disabled
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { adStatusChangeSchema } from "@/lib/admin/validation/ad-schema.ts"
import { changeAdStatus } from "@/lib/admin/services/ad-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(req, "ads.update", "admin ad status", adStatusChangeSchema, async (_admin, wctx, body) => {
    const { id } = await ctx.params
    const parsedId = bigintIdSchema.safeParse(id)
    if (!parsedId.success) throw zodFieldError(parsedId.error)
    return changeAdStatus(wctx, parsedId.data, body)
  })
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
