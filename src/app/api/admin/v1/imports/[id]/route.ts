// GET /api/admin/v1/imports/[id] —— 单条导入记录详情（imports.preview；只读）
import { handleRead, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { getImportRun } from "@/lib/admin/services/import-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRead(_req, "imports.preview", "admin import run detail", async () => {
    const { id } = await ctx.params
    const parsed = bigintIdSchema.safeParse(id)
    if (!parsed.success) throw zodFieldError(parsed.error)
    return getImportRun(parsed.data)
  })
}

export async function PUT() {
  return methodNotAllowed("GET")
}
export async function DELETE() {
  return methodNotAllowed("GET")
}
