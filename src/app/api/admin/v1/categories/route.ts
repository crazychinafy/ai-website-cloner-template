// GET  /api/admin/v1/categories —— 网址分类列表（分页 + q/status/parentId/includeDeleted + 排序白名单）
// POST /api/admin/v1/categories —— 新建分类（一级或二级；Service 内做同名/父级校验 + 审计）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { categoryListQuerySchema, createCategorySchema } from "@/lib/admin/validation/category-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createCategory, listCategories } from "@/lib/admin/services/category-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "categories.read", "admin categories list", () => {
    const parsed = categoryListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listCategories(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "categories.create", "admin categories create", createCategorySchema, (_admin, ctx, body) =>
    createCategory(ctx, body),
  )
}

export async function PUT() {
  return methodNotAllowed("GET, POST, PATCH")
}
