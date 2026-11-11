// PATCH /api/admin/v1/article-categories/reorder —— 全局批量排序（任一版本冲突整批回滚）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderArticleCategoriesSchema } from "@/lib/admin/validation/article-category-schema.ts"
import { reorderArticleCategories } from "@/lib/admin/services/article-category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  return handleWrite(
    req,
    "article_categories.update",
    "admin article-categories reorder",
    reorderArticleCategoriesSchema,
    (_admin, ctx, body) => reorderArticleCategories(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
