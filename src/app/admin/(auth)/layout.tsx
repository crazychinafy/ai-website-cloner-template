// (auth) 组 layout：认证页面（登录 / 改密）——不套用受保护守卫，避免重定向循环。
// 已登录访问本组页面 → 跳到后台首页或改密页。
import "@/components/admin/admin.css"
import { guardLoginPage } from "@/lib/admin/auth/guards.ts"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await guardLoginPage()
  return <div className="admin-page admin-center">{children}</div>
}
