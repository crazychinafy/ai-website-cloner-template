// /admin/bulletins/[id]（P6C）：编辑公告（编辑器子页；含发布/归档/删除入口）
import { requireAdminPagePermission } from "@/lib/admin/auth/guards.ts"
import { BulletinEditor } from "@/components/admin/content/BulletinEditor"

export const metadata = { title: "编辑公告 - 彩搜搜后台" }

export default async function EditBulletinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminPagePermission("bulletins.read")
  return (
    <BulletinEditor
      mode="edit"
      bulletinId={id}
      csrfToken={admin.csrfToken}
      canPublish={admin.permissions.includes("bulletins.publish")}
      canDelete={admin.permissions.includes("bulletins.delete")}
    />
  )
}
