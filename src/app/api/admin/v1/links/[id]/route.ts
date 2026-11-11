// /api/admin/v1/links/[id] —— 单条聚合：GET 详情（含 detail/mirrors）/ PATCH 聚合编辑（乐观锁）/ DELETE 软删除（?version=）
// 聚合 PATCH 合同：detail 省略=不改、null=删除详情、对象=upsert；mirrors 数组=全量替换；status 不在 PATCH（走 /status）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateLinkSchema } from "@/lib/admin/validation/link-schema.ts"
import { deleteLink, getLink, updateLink } from "@/lib/admin/services/link-service.ts"

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
  return handleRead(req, "links.read", "admin link get", async () => {
    const id = await routeId(ctx.params)
    return getLink(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(req, "links.update", "admin link update", updateLinkSchema, async (_admin, wctx, body) => {
    const id = await routeId(ctx.params)
    return updateLink(wctx, id, body)
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "links.delete", "admin link delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteLink(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
