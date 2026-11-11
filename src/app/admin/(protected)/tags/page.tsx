// /admin/tags（P6A）：标签管理（颜色 / iconfont 图标预览）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { TagsManager } from "@/components/admin/content/TagsManager"

export const metadata = { title: "标签管理 - 彩搜搜后台" }

export default async function AdminTagsPage() {
  const admin = await requireAdminPagePermission("tags.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">标签管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          网址彩色标签管理：名称 / iconfont 图标 / 前景背景颜色实时预览、启用停用、排序与软删除恢复。
        </p>
      </div>
      <TagsManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("tags.create")}
        canUpdate={admin.permissions.includes("tags.update")}
        canDelete={admin.permissions.includes("tags.delete")}
      />
    </div>
  )
}
