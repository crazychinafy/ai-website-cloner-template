// /admin/ads（P6D）：广告管理（列表 + 排期/状态/有效状态 + 启用停用 + 上下移 + 回收站）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { AdsManager } from "@/components/admin/content/AdsManager"

export const metadata = { title: "广告管理 - 彩搜搜后台" }

export default async function AdminAdsPage() {
  const admin = await requireAdminPagePermission("ads.read")
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">广告管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          广告（ads）管理：当前仅开放首页广告位；草稿→启用状态流转、投放排期（有效状态由服务端计算，只读展示）、
          同位置排序、软删除恢复。图片为站内静态路径，跳转地址由使用者自行确认（服务端不访问）。
        </p>
      </div>
      <AdsManager
        csrfToken={admin.csrfToken}
        canCreate={admin.permissions.includes("ads.create")}
        canUpdate={admin.permissions.includes("ads.update")}
        canDelete={admin.permissions.includes("ads.delete")}
      />
    </div>
  )
}
