// POST /api/admin/v1/articles/preview —— 正文预览（净化后 HTML 回显；不落库、不写审计、noindex）
// 权限：articles.read 过门 + 必须另有 articles.create 或 articles.update（预览是编辑流程的一部分）；
// 写语义 → 走完整 CSRF/Origin 校验；body 上限放宽到 MAX_BODY_BYTES_RICH（富文本）。
import { err } from "@/lib/admin/api/response.ts"
import { handleWrite, methodNotAllowed, MAX_BODY_BYTES_RICH } from "@/lib/admin/api/handler.ts"
import { articlePreviewSchema } from "@/lib/admin/validation/article-schema.ts"
import { previewArticle } from "@/lib/admin/services/article-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleWrite(
    req,
    "articles.read",
    "admin article preview",
    articlePreviewSchema,
    async (admin, _ctx, body) => {
      if (!admin.permissions.includes("articles.create") && !admin.permissions.includes("articles.update")) {
        return err("FORBIDDEN", "预览需要文章编辑权限", { status: 403 })
      }
      return previewArticle(body)
    },
    { maxBytes: MAX_BODY_BYTES_RICH },
  )
}

export async function GET() {
  return methodNotAllowed("POST")
}
