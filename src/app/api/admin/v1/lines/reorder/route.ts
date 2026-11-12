// POST /api/admin/v1/lines/reorder —— 批量排序（全局作用域；固定锁顺序；任一冲突整批回滚）
// 注意：静态段 reorder 必须先于 [id] 动态段被匹配（Next.js 静态段优先，本目录独立于 [id]/）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderLinesSchema } from "@/lib/admin/validation/line-schema.ts"
import { reorderLines } from "@/lib/admin/services/line-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleWrite(req, "lines.update", "admin lines reorder", reorderLinesSchema, (_admin, ctx, body) =>
    reorderLines(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("POST")
}
