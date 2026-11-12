// /admin/settings（P6D）：站点设置（白名单 6 key，分组卡片 + 逐组保存 + 逐 key 乐观锁）
// SSR 初始数据：getSettings 走幂等 init（缺失行按 SITE_INFO 默认值补建，绝不覆盖已有行）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { getSettings } from "@/lib/admin/services/site-setting-service.ts"
import { SettingsPanel } from "@/components/admin/settings/SettingsPanel"

export const metadata = { title: "站点设置 - 彩搜搜后台" }

export default async function AdminSettingsPage() {
  const admin = await requireAdminPagePermission("settings.read")
  const { data } = await getSettings()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">站点设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          站点设置（site_settings）：白名单 6 项（站点名称/描述、Logo/Favicon、页脚、广告随机排序），
          逐 key 乐观锁，保存为单事务整批回滚；品牌图片必须是站内静态图片路径。
        </p>
      </div>
      <SettingsPanel
        initial={data}
        csrfToken={admin.csrfToken}
        canUpdate={admin.permissions.includes("settings.update")}
      />
    </div>
  )
}
