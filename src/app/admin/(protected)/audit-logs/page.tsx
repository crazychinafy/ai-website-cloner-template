// /admin/audit-logs（P7）：操作日志（审计）—— 只读列表 + 详情弹窗
// 守卫：audit_logs.read（菜单隐藏 ≠ 授权，服务端守卫是唯一边界）
// 筛选项来自服务端 DISTINCT 真实值；DB 异常时降级为空选项（列表区自行显示错误态）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { getAuditFilterOptions } from "@/lib/admin/services/audit-service.ts"
import { AuditLogsManager } from "@/components/admin/system/AuditLogsManager"

export const metadata = { title: "操作日志 - 彩搜搜后台" }

export default async function AdminAuditLogsPage() {
  await requireAdminPagePermission("audit_logs.read")
  let options = { actions: [] as string[], resourceTypes: [] as string[], actors: [] as { id: string; username: string }[] }
  try {
    options = await getAuditFilterOptions()
  } catch {
    // 下拉选项拉取失败不阻塞页面；列表请求会展示真实错误
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">操作日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理员操作审计：只读、不可编辑、不可删除；before/after 快照由服务端统一脱敏后展示，
          IP 由 VARBINARY(16) 解码为文本；账号已删除的操作人显示「已删除管理员」。
        </p>
      </div>
      <AuditLogsManager options={options} />
    </div>
  )
}
