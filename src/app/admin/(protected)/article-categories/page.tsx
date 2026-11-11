// /admin/article-categories（P6A）：文章分类管理（独立一级资源）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { ArticleCategoriesManager } from "@/components/admin/content/ArticleCategoriesManager"

export const metadata = { title: "文章分类 - 彩搜搜后台" }

export default async function AdminArticleCategoriesPage() {
  const admin = await requireAdminPagePermission("article_categories.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">文章分类</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          文章栏目管理：新建 / 编辑、启用停用、排序与软删除恢复；与网址分类相互独立。
        </p>
      </div>
      <ArticleCategoriesManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("article_categories.create")}
        canUpdate={admin.permissions.includes("article_categories.update")}
        canDelete={admin.permissions.includes("article_categories.delete")}
      />
    </div>
  )
}
