// PATCH /api/admin/v1/tags/reorder —— 全局批量排序
import { handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { reorderTagsSchema } from "@/lib/admin/validation/tag-schema.ts"
import { reorderTags } from "@/lib/admin/services/tag-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  return handleWrite(req, "tags.update", "admin tags reorder", reorderTagsSchema, (_admin, ctx, body) =>
    reorderTags(ctx, body),
  )
}

export async function GET() {
  return methodNotAllowed("PATCH")
}
