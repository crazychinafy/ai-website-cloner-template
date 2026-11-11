// GET  /api/admin/v1/articles —— 文章列表（分页 + q(标题/作者)/status/categoryId/includeDeleted + 排序白名单）
// POST /api/admin/v1/articles —— 新建文章（恒 draft；authorName=管理员 displayName；正文 Service 净化 + 审计）
import { handleRead, handleWrite, methodNotAllowed, MAX_BODY_BYTES_RICH } from "@/lib/admin/api/handler.ts"
import { articleListQuerySchema, createArticleSchema } from "@/lib/admin/validation/article-schema.ts"
import { searchParamsRecord } from "@/lib/admin/validation/list-query.ts"
import { zodFieldError } from "@/lib/admin/validation/content-error.ts"
import { createArticle, listArticles } from "@/lib/admin/services/article-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "articles.read", "admin articles list", () => {
    const parsed = articleListQuerySchema.safeParse(searchParamsRecord(new URL(req.url).searchParams))
    if (!parsed.success) throw zodFieldError(parsed.error)
    return listArticles(parsed.data)
  })
}

export async function POST(req: Request) {
  return handleWrite(
    req,
    "articles.create",
    "admin articles create",
    createArticleSchema,
    (admin, ctx, body) => createArticle(ctx, admin.displayName, body),
    { maxBytes: MAX_BODY_BYTES_RICH },
  )
}

export async function PUT() {
  return methodNotAllowed("GET, POST")
}
