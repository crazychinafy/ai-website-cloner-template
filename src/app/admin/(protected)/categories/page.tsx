// /admin/categories（P6A）：网址分类管理
// - 服务端权限守卫：无 categories.read → /admin/forbidden（API 层仍独立校验，双重守卫）
// - 写权限按钮可见性由 Session 实时权限决定（canCreate/canUpdate/canDelete 仅作 UX；非安全边界）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { CategoriesManager } from "@/components/admin/content/CategoriesManager"

export const metadata = { title: "网址分类 - 彩搜搜后台" }

export default async function AdminCategoriesPage() {
  const admin = await requireAdminPagePermission("categories.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">网址分类</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          两级目录管理：新建 / 编辑 / 移动、启用停用（停用一级会同时停用其下二级）、同级排序与软删除恢复。
        </p>
      </div>
      <CategoriesManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("categories.create")}
        canUpdate={admin.permissions.includes("categories.update")}
        canDelete={admin.permissions.includes("categories.delete")}
      />
    </div>
  )
}
