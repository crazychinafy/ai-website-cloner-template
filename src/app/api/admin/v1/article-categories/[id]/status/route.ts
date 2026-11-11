// PATCH /api/admin/v1/article-categories/[id]/status —— 启用/停用
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { statusChangeSchema } from "@/lib/admin/validation/content-fields.ts"
import { changeArticleCategoryStatus } from "@/lib/admin/services/article-category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleWrite(
    req,
    "article_categories.update",
    "admin article-category status",
    statusChangeSchema,
    async (_admin, wctx, body) => {
      const { id } = await ctx.params
      const parsedId = bigintIdSchema.safeParse(id)
      if (!parsedId.success) throw zodFieldError(parsedId.error)
      return changeArticleCategoryStatus(wctx, parsedId.data, body)
    },
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
