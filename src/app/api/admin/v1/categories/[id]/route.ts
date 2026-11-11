// /api/admin/v1/categories/[id] —— 单条：GET 详情 / PATCH 更新（含移动父级）/ DELETE 软删除（?version=）
// 注意：动态参数与 ?version= 的校验都在管道函数内执行（ContentError 才能被统一捕获为信封）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateCategorySchema } from "@/lib/admin/validation/category-schema.ts"
import { deleteCategory, getCategory, updateCategory } from "@/lib/admin/services/category-service.ts"

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
  return handleRead(req, "categories.read", "admin category get", async () => {
    const id = await routeId(ctx.params)
    return getCategory(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(req, "categories.update", "admin category update", updateCategorySchema, async (_admin, wctx, body) => {
    const id = await routeId(ctx.params)
    return updateCategory(wctx, id, body)
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "categories.delete", "admin category delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteCategory(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
