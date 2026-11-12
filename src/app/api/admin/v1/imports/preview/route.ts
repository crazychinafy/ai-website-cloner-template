// POST /api/admin/v1/imports/preview —— 导入差异预览（imports.preview + CSRF）
// 零写入合同：整条链路只执行 SELECT —— 无 INSERT/UPDATE/DELETE、不写 admin_import_runs、不写审计
// （schema 注释「dry-run 也留痕」不适用 Web 预览：留痕只发生在正式导入；见 P7 任务书对 schema 注释的覆盖）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { previewImport } from "@/lib/admin/services/import-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleWrite(req, "imports.preview", "admin imports preview", null, () => previewImport())
}

export async function GET() {
  return methodNotAllowed("POST")
}
