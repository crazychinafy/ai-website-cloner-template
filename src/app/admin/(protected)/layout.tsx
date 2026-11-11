// (protected) 组 layout：所有后台业务页面的服务端守卫 + 独立布局
// ─────────────────────────────────────────────────────────────────
// - requireAdminPage：未登录 → /admin/login；mustChangePassword → /admin/change-password
//   （页面级保护，P3 实现；P5 不削弱）
// - AdminShell：独立 AdminLayout（禁止复用前台 SiteFrame/Header/导航，§3.1）
//   侧边导航（权限驱动）/ 顶部工具栏 / 面包屑 / 响应式 / Toast 全局
// - admin.css 为后台专属设计系统（Tailwind 入口仅在 admin 文档生效，前台零影响）
import "@/components/admin/admin.css"
import { AdminShell } from "@/components/admin/layout/AdminShell"
import { requireAdminPage } from "@/lib/admin/auth/guards.ts"

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage()
  return (
    <AdminShell
      admin={{
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        roles: admin.roles,
        permissions: admin.permissions,
        mustChangePassword: admin.mustChangePassword,
        csrfToken: admin.csrfToken,
        expiresAt: admin.expiresAt,
      }}
    >
      {children}
    </AdminShell>
  )
}
