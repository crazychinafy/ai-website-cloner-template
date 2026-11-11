// (auth) 组 layout：认证页面（登录 / 改密）
// - 本 layout 不套任何守卫：
//   - 登录页守卫（guardLoginPage）必须只作用于 /admin/login —— 若放在 layout 覆盖改密页，
//     mustChangePassword 用户登录后被整页跳到 /admin/change-password 时会被守卫再次
//     重定向回同一页（自 307 死循环，ERR_TOO_MANY_REDIRECTS）
//   - 改密页自带守卫（未登录 → /admin/login；已登录必改 → 正常渲染表单）
// - P5：浅色 SaaS 视觉（admin.css 独立设计系统；与前台样式彻底隔离）
// - ToastProvider：登录/改密表单用 useToast 反馈结果（SSR 期间同样存在上下文，
//   避免 useToast 在服务器渲染时抛错）
import "@/components/admin/admin.css"
import { ToastProvider } from "@/components/admin/feedback/ToastProvider"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-root flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <ToastProvider>
        <div className="w-full max-w-md">{children}</div>
      </ToastProvider>
    </div>
  )
}
