// /admin/links（P6B）：网址管理（列表 + 聚合编辑 + 发布/下架/停用 + 回收站）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { LinksManager } from "@/components/admin/content/LinksManager"

export const metadata = { title: "网址管理 - 彩搜搜后台" }

export default async function AdminLinksPage() {
  const admin = await requireAdminPagePermission("links.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">网址管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          网址（site_links）管理：分类/标签筛选、详情补充与备用链接聚合编辑、草稿→发布/停用状态流转、软删除恢复。
        </p>
      </div>
      <LinksManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("links.create")}
        canUpdate={admin.permissions.includes("links.update")}
        canPublish={admin.permissions.includes("links.publish")}
        canDelete={admin.permissions.includes("links.delete")}
      />
    </div>
  )
}
