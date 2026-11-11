"use client"

// P5：后台统一 API Client（客户端）
// ─────────────────────────────────────────────────────────────────
// - 统一处理 JSON 信封 { success, data, error, requestId }（与 src/lib/admin/api/response.ts 对应）
// - 统一处理 401 / 403 / 429 / 5xx 与字段级错误
// - 写请求必须显式传入 CSRF Token（X-CSRF-Token，后端实际合同）
// - 不把管理员 Token 存入 localStorage：Session 只存在于 HttpOnly Cookie
// - 401（Session 失效）→ 跳转登录页（带安全的 returnTo；每页最多一次）
// - 前台会员 Session（facai8_session）与此完全无关，本客户端只面向 /api/admin/v1

export interface AdminFieldErrors {
  [field: string]: string
}

export interface AdminApiError {
  /** HTTP 状态码（网络失败时为 0） */
  status: number
  /** 服务端错误码（VALIDATION_ERROR / UNAUTHORIZED / ... / INTERNAL_ERROR；网络失败 = NETWORK_ERROR） */
  code: string
  /** 服务端返回的用户可见文案（不含 SQL/堆栈/凭据） */
  message: string
  /** 字段级错误（表单用） */
  fields?: AdminFieldErrors
  /** 请求追踪 ID（服务端统一信封） */
  requestId?: string
  /** 429 重试建议（秒） */
  retryAfter?: number
}

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AdminApiError }

/** GET /api/admin/v1/auth/session 的数据结构（与 admin-auth-service.ts SessionResult 对应） */
export interface AdminSessionInfo {
  id: string
  username: string
  displayName: string
  roles: string[]
  permissions: string[]
  mustChangePassword: boolean
  csrfToken: string
  expiresAt: string
}

/** 可序列化的管理员身份（服务端页面传给客户端组件；不含敏感字段） */
export type AdminIdentityLite = Omit<AdminSessionInfo, never>

const API_BASE = "/api/admin/v1"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code?: string; message?: string; fields?: AdminFieldErrors }
  requestId?: string
}

/**
 * 安全的 returnTo（实现见 ./return-to.ts，同构纯函数）。
 * 在此再导出：保持既有客户端导入路径不变（LoginForm / ChangePasswordForm）。
 * 服务端页面请直接 import "@/lib/admin/ui/return-to"（本模块是 "use client"）。
 */
import { safeReturnTo } from "./return-to"

export { safeReturnTo }

/** 401 全局处理：跳转登录页（同页去重，防多组件并发请求重复跳转） */
let unauthorizedRedirected = false
export function resetUnauthorizedGuard(): void {
  unauthorizedRedirected = false
}

function redirectToLogin(): void {
  if (unauthorizedRedirected) return
  unauthorizedRedirected = true
  const path = window.location.pathname
  const suffix = safeReturnTo(path) ? `?returnTo=${encodeURIComponent(path)}` : ""
  window.location.replace(`/admin/login${suffix}`)
}

function readRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

async function parseEnvelope<T>(res: Response): Promise<Envelope<T>> {
  try {
    return (await res.json()) as Envelope<T>
  } catch {
    return { success: false }
  }
}

function toApiError(status: number, env: Envelope<unknown>, retryAfter?: number): AdminApiError {
  return {
    status,
    code: env.error?.code ?? (status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR"),
    message: env.error?.message ?? "服务暂时不可用，请稍后重试",
    fields: env.error?.fields,
    requestId: env.requestId,
    retryAfter,
  }
}

export interface AdminRequestOptions {
  /** 写请求必须传入（来自服务端下发的 Session 派生 token） */
  csrfToken?: string
  signal?: AbortSignal
  /** 发生 401 时是否触发登录跳转（登录请求自身传 false） */
  onUnauthorized?: boolean
}

async function request<T>(path: string, init?: RequestInit, opts: AdminRequestOptions = {}): Promise<AdminResult<T>> {
  const onUnauthorized = opts.onUnauthorized ?? true
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "same-origin",
      signal: opts.signal,
    })
  } catch (e) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "NETWORK_ERROR",
        message: e instanceof DOMException && e.name === "AbortError" ? "请求已取消" : "网络异常，请检查连接后重试",
      },
    }
  }

  const env = await parseEnvelope<T>(res)

  if (res.ok) {
    if (env.success) {
      return { ok: true, data: (env.data ?? ({} as T)) as T }
    }
    // 2xx 但信封 success=false（理论上不存在）：按错误处理
    return { ok: false, error: toApiError(res.status, env) }
  }

  const error = toApiError(res.status, env, readRetryAfter(res.headers))

  if (res.status === 401 && onUnauthorized && typeof window !== "undefined") {
    redirectToLogin()
  }

  return { ok: false, error }
}

export function adminGet<T>(path: string, opts: AdminRequestOptions = {}): Promise<AdminResult<T>> {
  return request<T>(path, { method: "GET" }, opts)
}

export function adminPost<T>(
  path: string,
  body: unknown,
  opts: AdminRequestOptions & { csrfToken: string },
): Promise<AdminResult<T>> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": opts.csrfToken,
      },
      body: JSON.stringify(body ?? {}),
    },
    opts,
  )
}

/** P6A：PATCH（部分更新 / 状态切换 / 批量排序） */
export function adminPatch<T>(
  path: string,
  body: unknown,
  opts: AdminRequestOptions & { csrfToken: string },
): Promise<AdminResult<T>> {
  return request<T>(
    path,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": opts.csrfToken,
      },
      body: JSON.stringify(body ?? {}),
    },
    opts,
  )
}

/** P6A：DELETE（软删除；版本在调用方拼进查询串：path + `?version=`） */
export function adminDelete<T>(
  path: string,
  opts: AdminRequestOptions & { csrfToken: string },
): Promise<AdminResult<T>> {
  return request<T>(
    path,
    {
      method: "DELETE",
      headers: { "X-CSRF-Token": opts.csrfToken },
    },
    opts,
  )
}

/** ── 认证域 API（P3 已实现，P5 统一接入）──────────────────── */

export const adminApi = {
  session: (): Promise<AdminResult<AdminSessionInfo>> => adminGet<AdminSessionInfo>("/auth/session"),

  login: (username: string, password: string): Promise<AdminResult<unknown>> =>
    // 登录请求不带 CSRF（尚无 Session）；401 不触发跳转
    request<unknown>(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
      { onUnauthorized: false },
    ),

  logout: (csrfToken: string): Promise<AdminResult<unknown>> =>
    adminPost<unknown>("/auth/logout", {}, { csrfToken, onUnauthorized: false }),

  /** 服务端 Zod 合同要求三字段齐全（含 confirmPassword）：缺失即 422 字段错误 */
  changePassword: (
    input: { oldPassword: string; newPassword: string; confirmPassword: string },
    csrfToken: string,
  ): Promise<AdminResult<unknown>> =>
    adminPost<unknown>("/auth/change-password", input, { csrfToken, onUnauthorized: false }),
}
