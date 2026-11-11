// PATCH /api/admin/v1/bulletins/[id]/status —— 发布状态机（bulletins.publish）
// draft→published / draft→archived / published→archived / archived→published；published→draft 禁止（422）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { bulletinStatusChangeSchema } from "@/lib/admin/validation/bulletin-schema.ts"
import { changeBulletinStatus } from "@/lib/admin/services/bulletin-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(
    req,
    "bulletins.publish",
    "admin bulletin status",
    bulletinStatusChangeSchema,
    async (_admin, wctx, body) => {
      const { id } = await ctx.params
      const parsedId = bigintIdSchema.safeParse(id)
      if (!parsedId.success) throw zodFieldError(parsedId.error)
      return changeBulletinStatus(wctx, parsedId.data, body)
    },
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
