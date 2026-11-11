// /admin/articles/new（P6C）：新建文章（分节编辑器子页；保存恒为草稿）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { ArticleEditor } from "@/components/admin/content/ArticleEditor"

export const metadata = { title: "新建文章 - 彩搜搜后台" }

export default async function NewArticlePage() {
  const admin = await requireAdminPagePermission("articles.read")
  return (
    <ArticleEditor
      mode="create"
      csrfToken={admin.csrfToken}
      canPublish={admin.permissions.includes("articles.publish")}
      canDelete={false}
    />
  )
}
