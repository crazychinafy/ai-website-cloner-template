// /admin/articles（P6C）：文章管理（列表 + 状态流转 + 回收站；编辑走 /new 与 /[id] 子页）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { ArticlesManager } from "@/components/admin/content/ArticlesManager"

export const metadata = { title: "文章管理 - 彩搜搜后台" }

export default async function AdminArticlesPage() {
  const admin = await requireAdminPagePermission("articles.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">文章管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          文章（articles）管理：标题/作者搜索、分类与状态筛选、草稿→发布/归档状态流转、软删除恢复；富文本正文由服务端白名单净化。
        </p>
      </div>
      <ArticlesManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("articles.create")}
        canUpdate={admin.permissions.includes("articles.update")}
        canPublish={admin.permissions.includes("articles.publish")}
        canDelete={admin.permissions.includes("articles.delete")}
      />
    </div>
  )
}
