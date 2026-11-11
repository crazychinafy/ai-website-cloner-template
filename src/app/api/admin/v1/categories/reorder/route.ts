// PATCH /api/admin/v1/categories/reorder —— 同一父级作用域批量排序（每条带 version，任一冲突整批 409 回滚）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderCategoriesSchema } from "@/lib/admin/validation/category-schema.ts"
import { reorderCategories } from "@/lib/admin/services/category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  return handleWrite(req, "categories.update", "admin categories reorder", reorderCategoriesSchema, (_admin, ctx, body) =>
    reorderCategories(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
