// GET  /api/admin/v1/ads —— 广告列表（分页 + q(标题)/position/status/includeDeleted + 白名单排序，默认 sortOrder asc）
// POST /api/admin/v1/ads —— 新建广告（恒 draft、version=1；imagePath 服务端存在性校验；Service 事务 + 审计）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { adListQuerySchema, createAdSchema } from "@/lib/admin/validation/ad-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createAd, listAds } from "@/lib/admin/services/ad-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "ads.read", "admin ads list", () => {
    const parsed = adListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listAds(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(req, "ads.create", "admin ads create", createAdSchema, (_admin, ctx, body) => createAd(ctx, body))
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
