// POST /api/admin/v1/lines/[id]/restore —— 恢复软删除（body { version }；保留原 name/url/status/排序，§6.6）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { versionBodySchema } from "@/lib/admin/validation/content-fields.ts"
import { restoreLineRecord } from "@/lib/admin/services/line-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(req, "lines.delete", "admin line restore", versionBodySchema, async (_admin, wctx, body) => {
    const { id } = await ctx.params
    const parsedId = bigintIdSchema.safeParse(id)
    if (!parsedId.success) throw zodFieldError(parsedId.error)
    return restoreLineRecord(wctx, parsedId.data, body.version)
  })
}

export async function GET() {
  return methodNotAllowed("POST")
}
