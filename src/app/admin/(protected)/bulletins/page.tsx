// /admin/bulletins（P6C）：公告管理（列表 + 状态流转 + 上移/下移排序 + 回收站；编辑走 /new 与 /[id] 子页）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { BulletinsManager } from "@/components/admin/content/BulletinsManager"

export const metadata = { title: "公告管理 - 彩搜搜后台" }

export default async function AdminBulletinsPage() {
  const admin = await requireAdminPagePermission("bulletins.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">公告管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          公告（bulletins）管理：标题搜索、状态筛选、草稿→发布/归档状态流转、排序值上移/下移（批量事务）、软删除恢复。
        </p>
      </div>
      <BulletinsManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("bulletins.create")}
        canUpdate={admin.permissions.includes("bulletins.update")}
        canPublish={admin.permissions.includes("bulletins.publish")}
        canDelete={admin.permissions.includes("bulletins.delete")}
      />
    </div>
  )
}
