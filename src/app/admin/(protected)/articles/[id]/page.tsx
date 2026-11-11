// /admin/articles/[id]（P6C）：编辑文章（分节编辑器子页；含发布/归档/删除入口）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { ArticleEditor } from "@/components/admin/content/ArticleEditor"

export const metadata = { title: "编辑文章 - 彩搜搜后台" }

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminPagePermission("articles.read")
  return (
    <ArticleEditor
      mode="edit"
      articleId={id}
      csrfToken={admin.csrfToken}
      canPublish={admin.permissions.includes("articles.publish")}
      canDelete={admin.permissions.includes("articles.delete")}
    />
  )
}
