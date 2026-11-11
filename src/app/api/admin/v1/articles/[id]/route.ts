// /api/admin/v1/articles/[id] —— GET 详情（含软删除行）/ PATCH 编辑（乐观锁，无 status）/ DELETE 软删除（?version=）
// status 不在 PATCH（走 /status + articles.publish）；authorName/viewCount/publishedAt 客户端不可改（strictObject 422）
import { handleRead, handleWrite, methodNotAllowed, MAX_BODY_BYTES_RICH } from "@/lib/admin/api/handler.ts"
import { bigintIdSchema, parseVersionParam } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { updateArticleSchema } from "@/lib/admin/validation/article-schema.ts"
import { deleteArticle, getArticle, updateArticle } from "@/lib/admin/services/article-service.ts"

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
  return handleRead(req, "articles.read", "admin article get", async () => {
    const id = await routeId(ctx.params)
    return getArticle(id)
  })
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handleWrite(
    req,
    "articles.update",
    "admin article update",
    updateArticleSchema,
    async (_admin, wctx, body) => {
      const id = await routeId(ctx.params)
      return updateArticle(wctx, id, body)
    },
    { maxBytes: MAX_BODY_BYTES_RICH },
  )
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleWrite(req, "articles.delete", "admin article delete", null, async (_admin, wctx) => {
    const id = await routeId(ctx.params)
    return deleteArticle(wctx, id, parseVersionParam(req))
  })
}

export async function POST() {
  return methodNotAllowed("GET, PATCH, DELETE")
}
