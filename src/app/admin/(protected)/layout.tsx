// (protected) 组 layout：所有后台业务页面的服务端守卫（页面级保护，非 Middleware）
// - 未登录 → 重定向 /admin/login
// - must_change_password → 重定向 /admin/change-password（改密前禁止进入业务页面）
// - 顶栏展示当前管理员与退出入口（完整后台 UI 留给 P5）
import Link from "next/link"
import "@/components/admin/admin.css"
import { LogoutButton } from "@/components/admin/LogoutButton"
import { requireAdminPage } from "@/lib/admin/auth/guards.ts"

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage()
  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-topbar">
          <span className="admin-brand">彩搜搜管理后台</span>
          <span className="admin-who">
            {admin.displayName}（{admin.username}）
            {admin.roles.length > 0 ? ` · ${admin.roles.join(" / ")}` : ""}
          </span>
          <LogoutButton csrfToken={admin.csrfToken} />
        </header>
        <main className="admin-content">{children}</main>
      </div>
      <footer className="admin-note" style={{ textAlign: "center", marginBottom: 12 }}>
        <Link className="admin-link" href="/admin/change-password">
          修改密码
        </Link>
      </footer>
    </div>
  )
}
