// P3：页面级守卫（App Router 服务端组件用；API 守卫见 permissions/require-permission.ts）
// - (protected)/layout 调用 requireAdminPage：未登录 → 重定向 /admin/login
// - must_change_password = true → 重定向 /admin/change-password（改密前不得进入业务页面）
// - 与 API 守卫共用同一 verifySession 实现（每次请求实时查库，禁用/撤销立即生效）
// - 注意：/admin/login、/admin/change-password 位于 (auth) 组，不套用本守卫（避免重定向循环）
import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ADMIN_SESSION_COOKIE, parseAdminToken } from "./cookies.ts"
import { verifySession } from "./session.ts"
import type { AdminIdentity } from "./session.ts"

/** 读取并验证当前管理员工 Session（页面上下文；无效返回 null） */
export async function getAdminFromCookies(): Promise<AdminIdentity | null> {
  const store = await cookies()
  const raw = store.get(ADMIN_SESSION_COOKIE)?.value
  const token = parseAdminToken(raw ? `${ADMIN_SESSION_COOKIE}=${raw}` : null)
  if (!token) return null
  return verifySession(token)
}

// 同一请求内 layout 与 page 共用一次验证（App Router 请求级缓存）
const getAdminOnce = cache(getAdminFromCookies)

/**
 * (protected) 页面通用守卫：
 * - 未登录 → redirect /admin/login
 * - must_change_password → redirect /admin/change-password
 * - 通过 → 返回身份（layout/page 渲染用）
 */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const admin = await getAdminOnce()
  if (!admin) redirect("/admin/login")
  if (admin.mustChangePassword) redirect("/admin/change-password")
  return admin
}

/** (auth) 登录页守卫：已登录访问登录页 → 跳到首页或改密页（避免重复登录） */
export async function guardLoginPage(): Promise<AdminIdentity | null> {
  const admin = await getAdminOnce()
  if (!admin) return null
  redirect(admin.mustChangePassword ? "/admin/change-password" : "/admin")
}
