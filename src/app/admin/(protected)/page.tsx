// 后台首页占位（P3）：展示当前管理员身份、角色与权限数量。完整仪表盘 UI 留给 P5。
import { requireAdminPage } from "@/lib/admin/auth/guards.ts"

export const metadata = { title: "首页 - 彩搜搜后台" }

export default async function AdminHomePage() {
  const admin = await requireAdminPage()
  return (
    <div>
      <h1 className="admin-hello">欢迎，{admin.displayName}</h1>
      <p className="admin-permcount">
        用户名 {admin.username}
        {admin.roles.length > 0 ? `，角色：` : "（当前无角色）"}
      </p>
      {admin.roles.length > 0 ? (
        <div className="admin-rolebadges">
          {admin.roles.map((r) => (
            <span key={r} className="admin-badge">
              {r}
            </span>
          ))}
        </div>
      ) : null}
      <p className="admin-permcount">当前有效权限 {admin.permissions.length} 项（每次请求实时校验）</p>
    </div>
  )
}
