// POST /api/admin/v1/ads/[id]/restore —— 恢复软删除（body { version }；保留原位置/排序/投放时间/状态，§5.7）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { versionBodySchema } from "@/lib/admin/validation/content-fields.ts"
import { restoreAdRecord } from "@/lib/admin/services/ad-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(req, "ads.delete", "admin ad restore", versionBodySchema, async (_admin, wctx, body) => {
    const { id } = await ctx.params
    const parsedId = bigintIdSchema.safeParse(id)
    if (!parsedId.success) throw zodFieldError(parsedId.error)
    return restoreAdRecord(wctx, parsedId.data, body.version)
  })
}

export async function GET() {
  return methodNotAllowed("POST")
}
