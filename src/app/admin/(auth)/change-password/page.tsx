// /admin/change-password（P5 重写）：
// - 未登录 → 回登录页；改密完成 → returnTo || /admin
// - CSRF Token 由服务端 Session 派生后注入（客户端不重复请求 Session）
import { redirect } from "next/navigation"
import { ChangePasswordForm } from "@/components/admin/ChangePasswordForm"
import { getAdminFromCookies } from "@/lib/admin/auth/guards.ts"
import { safeReturnTo } from "@/lib/admin/ui/return-to"

export const metadata = { title: "修改密码 - 彩搜搜后台" }

interface Props {
  searchParams: Promise<{ returnTo?: string }>
}

export default async function AdminChangePasswordPage({ searchParams }: Props) {
  const admin = await getAdminFromCookies()
  if (!admin) redirect("/admin/login")
  const { returnTo } = await searchParams
  return <ChangePasswordForm csrfToken={admin.csrfToken} returnTo={safeReturnTo(returnTo ?? null)} />
}
