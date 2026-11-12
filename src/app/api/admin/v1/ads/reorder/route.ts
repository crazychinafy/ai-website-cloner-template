// POST /api/admin/v1/ads/reorder —— 批量排序（同 position 作用域；固定锁顺序；任一冲突整批回滚）
// 注意：静态段 reorder 必须先于 [id] 动态段被匹配（Next.js 静态段优先，本目录独立于 [id]/）
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderAdsSchema } from "@/lib/admin/validation/ad-schema.ts"
import { reorderAds } from "@/lib/admin/services/ad-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleWrite(req, "ads.update", "admin ads reorder", reorderAdsSchema, (_admin, ctx, body) =>
    reorderAds(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("POST")
}
