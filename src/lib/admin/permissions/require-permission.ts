// P3：统一权限守卫 —— 所有后台 API 的唯一身份/权限入口（安全文档 §3）
// - Route Handler 一律调用这里的函数，禁止在各 API 中重复编写鉴权逻辑
// - 401 = 未登录/Session 失效；403 = 权限不足 / 强制改密未满足
// - 权限每次请求实时查库（verifySession），角色/权限变更后下一次请求立即生效
// - 纯 Request 依赖（无 next/headers）：页面级守卫见 auth/guards.ts，二者共用同一 verifySession 实现
import { err } from "@/lib/admin/api/response"
import { parseAdminToken } from "@/lib/admin/auth/cookies.ts"
import { verifySession } from "@/lib/admin/auth/session.ts"
import type { AdminIdentity } from "@/lib/admin/auth/session.ts"
import type { AdminDb } from "@/lib/db/client"

/** 守卫通过：携带本次请求实时加载的管理员身份（含最新角色/权限） */
export interface GuardOk {
  ok: true
  admin: AdminIdentity
}

/** 守卫拒绝：已组装好的统一错误响应（401/403） */
export interface GuardFail {
  ok: false
  response: Response
}

export type GuardResult = GuardOk | GuardFail

/**
 * 当前请求的管理员身份（唯一凭证 = HttpOnly Cookie 中的 token，每次调用重新验证
 * DB Session 状态；前台 facai8_session 与此完全无关）。
 */
export async function getCurrentAdmin(req: Request, db?: AdminDb): Promise<AdminIdentity | null> {
  const token = parseAdminToken(req.headers.get("cookie"))
  if (!token) return null
  return verifySession(token, db)
}

/** 要求已登录：未登录/Session 失效/管理员被禁用或软删除 → 401 */
export async function requireAdminSession(req: Request, db?: AdminDb): Promise<GuardResult> {
  const admin = await getCurrentAdmin(req, db)
  if (!admin) return fail401()
  return { ok: true, admin }
}

/**
 * 要求已登录 + 持有指定权限：
 * - 未登录 → 401
 * - must_change_password 未满足 → 403 CHANGE_PASSWORD_REQUIRED（改密前禁止进入业务功能）
 * - 无对应权限 → 403（前端菜单隐藏不构成授权边界）
 */
export async function requireAdminPermission(
  req: Request,
  permission: string,
  db?: AdminDb,
): Promise<GuardResult> {
  const session = await requireAdminSession(req, db)
  if (!session.ok) return session
  if (session.admin.mustChangePassword) {
    return {
      ok: false,
      response: err("CHANGE_PASSWORD_REQUIRED", "请先完成密码修改后再使用后台功能", { status: 403 }),
    }
  }
  if (!session.admin.permissions.includes(permission)) {
    return {
      ok: false,
      response: err("FORBIDDEN", "当前账号无此权限", { status: 403 }),
    }
  }
  return session
}

function fail401(): GuardFail {
  return { ok: false, response: err("UNAUTHORIZED", "请先登录", { status: 401 }) }
}
