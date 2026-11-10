// 修改密码页：需要有效 Session（未登录 → 回登录页）；改密完成 → 进入后台首页
import { redirect } from "next/navigation"
import { ChangePasswordForm } from "@/components/admin/ChangePasswordForm"
import { getAdminFromCookies } from "@/lib/admin/auth/guards.ts"

export const metadata = { title: "修改密码 - 彩搜搜后台" }

export default async function AdminChangePasswordPage() {
  const admin = await getAdminFromCookies()
  if (!admin) redirect("/admin/login")
  return <ChangePasswordForm />
}
