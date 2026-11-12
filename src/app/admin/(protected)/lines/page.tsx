// /admin/lines（P6D）：线路管理（列表 + 新建/编辑 + 启用停用 + 上下移 + 回收站）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { LinesManager } from "@/components/admin/content/LinesManager"

export const metadata = { title: "线路管理 - 彩搜搜后台" }

export default async function AdminLinesPage() {
  const admin = await requireAdminPagePermission("lines.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">线路管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          线路（site_lines）管理：新建默认停用，启用/停用状态流转、全局排序、软删除恢复；
          URL 只做服务端语法校验，不做可达性探测（探测属前台）。
        </p>
      </div>
      <LinesManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("lines.create")}
        canUpdate={admin.permissions.includes("lines.update")}
        canDelete={admin.permissions.includes("lines.delete")}
      />
    </div>
  )
}
