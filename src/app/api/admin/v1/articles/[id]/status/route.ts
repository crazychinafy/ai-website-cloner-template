// PATCH /api/admin/v1/articles/[id]/status —— 发布状态机（articles.publish）
// draft→published / draft→archived / published→archived / archived→published；published→draft 禁止（422）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { articleStatusChangeSchema } from "@/lib/admin/validation/article-schema.ts"
import { changeArticleStatus } from "@/lib/admin/services/article-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(
    req,
    "articles.publish",
    "admin article status",
    articleStatusChangeSchema,
    async (_admin, wctx, body) => {
      const { id } = await ctx.params
      const parsedId = bigintIdSchema.safeParse(id)
      if (!parsedId.success) throw zodFieldError(parsedId.error)
      return changeArticleStatus(wctx, parsedId.data, body)
    },
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
