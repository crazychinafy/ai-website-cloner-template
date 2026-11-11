// POST /api/admin/v1/bulletins/reorder —— 批量排序（单事务；逐行乐观锁；任一冲突整批回滚）
// body { items: [{ id, sortOrder, version }] }；ID 去重在 Zod，存在/未删除/版本在 Service
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderBulletinsSchema } from "@/lib/admin/validation/bulletin-schema.ts"
import { reorderBulletins } from "@/lib/admin/services/bulletin-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleWrite(req, "bulletins.update", "admin bulletins reorder", reorderBulletinsSchema, (_admin, ctx, body) =>
    reorderBulletins(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("POST")
}
