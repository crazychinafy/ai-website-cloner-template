// /admin/bulletins/new（P6C）：新建公告（编辑器子页；保存恒为草稿）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { BulletinEditor } from "@/components/admin/content/BulletinEditor"

export const metadata = { title: "新建公告 - 彩搜搜后台" }

export default async function NewBulletinPage() {
  const admin = await requireAdminPagePermission("bulletins.read")
  return (
    <BulletinEditor
      mode="create"
      csrfToken={admin.csrfToken}
      canPublish={admin.permissions.includes("bulletins.publish")}
      canDelete={false}
    />
  )
}
