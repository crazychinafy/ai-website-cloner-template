// GET  /api/admin/v1/article-categories —— 文章分类列表
// POST /api/admin/v1/article-categories —— 新建
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { articleCategoryListQuerySchema, createArticleCategorySchema } from "@/lib/admin/validation/article-category-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createArticleCategory, listArticleCategories } from "@/lib/admin/services/article-category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "article_categories.read", "admin article-categories list", () => {
    const parsed = articleCategoryListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listArticleCategories(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(
    req,
    "article_categories.create",
    "admin article-categories create",
    createArticleCategorySchema,
    (_admin, ctx, body) => createArticleCategory(ctx, body),
  )
}

export async function PUT() {
  return methodNotAllowed("GET, POST, PATCH")
}
