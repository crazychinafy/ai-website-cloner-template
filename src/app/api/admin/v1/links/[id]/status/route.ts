// PATCH /api/admin/v1/links/[id]/status —— 发布/下架/停用（links.publish 权限；状态机 + 发布前置校验，非法转换 422）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { linkStatusChangeSchema } from "@/lib/admin/validation/link-schema.ts"
import { changeLinkStatus } from "@/lib/admin/services/link-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(req, "links.publish", "admin link status", linkStatusChangeSchema, async (_admin, wctx, body) => {
    const { id } = await ctx.params
    const parsedId = bigintIdSchema.safeParse(id)
    if (!parsedId.success) throw zodFieldError(parsedId.error)
    return changeLinkStatus(wctx, parsedId.data, body)
  })
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
