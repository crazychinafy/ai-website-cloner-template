// /admin/imports（P7）：数据导入管理（差异预览 + 安全执行 + 历史记录）
// 守卫：imports.preview（查看）；执行按钮按 imports.execute 显隐 —— 服务端 API 仍独立强制
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { ImportsManager } from "@/components/admin/system/ImportsManager"

export const metadata = { title: "数据导入 - 彩搜搜后台" }

export default async function AdminImportsPage() {
  const admin = await requireAdminPagePermission("imports.preview")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">数据导入</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          静态快照 → MySQL（复用 P4 导入核心，不存在第二套实现）：预览零写入；执行需预览回执、
          手输库名二次确认与 MySQL 命名锁互斥；导入历史只读，含 CLI 记录。
        </p>
      </div>
      <ImportsManager
        csrfToken={admin.csrfToken}
        canExecute={admin.permissions.includes("imports.execute")}
      />
    </div>
  )
}
