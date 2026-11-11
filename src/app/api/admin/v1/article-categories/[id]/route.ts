// /api/admin/v1/article-categories/[id] —— GET 详情 / PATCH 更新 / DELETE 软删除（?version=）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateArticleCategorySchema } from "@/lib/admin/validation/article-category-schema.ts"
import { deleteArticleCategory, getArticleCategory, updateArticleCategory } from "@/lib/admin/services/article-category-service.ts"

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
  return handleRead(req, "article_categories.read", "admin article-category get", async () => {
    const id = await routeId(ctx.params)
    return getArticleCategory(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(
    req,
    "article_categories.update",
    "admin article-category update",
    updateArticleCategorySchema,
    async (_admin, wctx, body) => {
      const id = await routeId(ctx.params)
      return updateArticleCategory(wctx, id, body)
    },
  )
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "article_categories.delete", "admin article-category delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteArticleCategory(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
