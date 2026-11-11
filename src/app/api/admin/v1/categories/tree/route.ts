// GET /api/admin/v1/categories/tree —— 两级树（管理页/选择器；保留祖先的一致性过滤）
import { handleRead, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { categoryTreeQuerySchema } from "@/lib/admin/validation/category-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { getCategoryTree } from "@/lib/admin/services/category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "categories.read", "admin categories tree", () => {
    const parsed = categoryTreeQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return getCategoryTree(parsed.data)
  })
}

export async function POST() {
  return methodNotAllowed("GET")
}
