// GET  /api/admin/v1/imports —— 导入历史列表（imports.preview；只读）
// POST /api/admin/v1/imports —— 执行静态导入（imports.execute + CSRF + 预览回执 + 二次确认 + 命名锁）
// 合同：不存在 PUT/PATCH/DELETE —— 导入记录只增不改不删（历史不可编辑）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { importExecuteBodySchema, importRunListQuerySchema } from "@/lib/admin/validation/import-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { executeImport, listImportRuns } from "@/lib/admin/services/import-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "imports.preview", "admin imports list", () => {
    const parsed = importRunListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listImportRuns(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "imports.execute", "admin imports execute", importExecuteBodySchema, (_admin, ctx, body) =>
    executeImport(body, ctx),
  )
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
export async function PATCH() {
  return methodNotAllowed("GET, POST")
}
export async function DELETE() {
  return methodNotAllowed("GET, POST")
}
