// P6A：内容管理 Route Handler 共享管道
// ─────────────────────────────────────────────────────────────────
// Route Handler → 认证 + RBAC（+ 写操作 CSRF/Origin）→ Zod 校验 → Service
// Service 抛 ContentError → 统一错误信封；其他异常 → 500 通用文案（详情只进日志）
import "server-only"
import { timingSafeEqual } from "node:crypto"
import type { z } from "zod"
import type { AdminIdentity } from "@/lib/admin/auth/session.ts"
import { isWriteOriginAllowed } from "@/lib/admin/auth/csrf.ts"
import { requireAdminPermission } from "@/lib/admin/permissions/require-permission.ts"
import { internal, newRequestId, ok, err, methodNotAllow } from "@/lib/admin/api/response.ts"
import { ContentError, contentErrorResponse, zodErrorResponse } from "@/lib/admin/validation/content-error.ts"
import type { WriteCtx } from "@/lib/admin/audit/audit-writer.ts"
import type { AdminDb } from "@/lib/db/client"

const MAX_BODY_BYTES = 64 * 1024

export type RouteResult = { data: unknown; status?: number }

/** 只读：Session + 权限；data = Service 返回值 */
export async function handleRead(
  req: Request,
  permission: string,
  ctxLabel: string,
  fn: (admin: AdminIdentity, ctx: WriteCtx) => Promise<RouteResult | unknown>,
  db?: AdminDb,
): Promise<Response> {
  const guard = await requireAdminPermission(req, permission, db)
  if (!guard.ok) return guard.response
  const ctx: WriteCtx = { actorUserId: guard.admin.id, requestId: newRequestId(), req }
  try {
    const result = await fn(guard.admin, ctx)
    if (result instanceof Response) return result
    if (result && typeof result === "object" && "data" in (result as RouteResult)) {
      const r = result as RouteResult
      return ok(r.data, { status: r.status })
    }
    return ok(result)
  } catch (e) {
    if (e instanceof ContentError) return contentErrorResponse(e)
    return internal(e, ctxLabel)
  }
}

/**
 * 写操作：Session + 权限 + Origin + X-CSRF-Token（合同见 api-client.ts：
 * 头 X-CSRF-Token = Session 派生 csrfToken，服务端常量时间比对，失败 fail-closed）。
 */
export async function requireAdminForWrite(
  req: Request,
  permission: string,
  db?: AdminDb,
): Promise<{ ok: true; admin: AdminIdentity; ctx: WriteCtx } | { ok: false; response: Response }> {
  const guard = await requireAdminPermission(req, permission, db)
  if (!guard.ok) return guard
  if (!isWriteOriginAllowed(req)) {
    return { ok: false, response: err("CSRF_INVALID", "请求来源不受信任", { status: 403 }) }
  }
  if (!csrfMatches(guard.admin.csrfToken, req.headers.get("x-csrf-token"))) {
    return { ok: false, response: err("CSRF_INVALID", "CSRF 校验失败，请刷新页面后重试", { status: 403 }) }
  }
  return { ok: true, admin: guard.admin, ctx: { actorUserId: guard.admin.id, requestId: newRequestId(), req } }
}

function csrfMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(provided)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** 解析并校验 JSON 请求体（Content-Type + 64KB 上限 + Zod） */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (ct !== "application/json") {
    return { ok: false, response: err("VALIDATION_ERROR", "请求格式错误", { status: 422 }) }
  }
  let parsed: unknown
  try {
    const buf = await req.arrayBuffer()
    if (buf.byteLength > MAX_BODY_BYTES) {
      return { ok: false, response: err("VALIDATION_ERROR", "请求体过大", { status: 422 }) }
    }
    parsed = JSON.parse(new TextDecoder().decode(buf))
  } catch {
    return { ok: false, response: err("VALIDATION_ERROR", "请求格式错误（JSON 解析失败）", { status: 422 }) }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) return { ok: false, response: zodErrorResponse(result.error) }
  return { ok: true, data: result.data }
}

/** 写操作完整管道：guard → JSON body（可选）→ Service */
export async function handleWrite<TSchema>(
  req: Request,
  permission: string,
  ctxLabel: string,
  bodySchema: z.ZodType<TSchema> | null,
  fn: (admin: AdminIdentity, ctx: WriteCtx, body: TSchema) => Promise<RouteResult | unknown>,
  db?: AdminDb,
): Promise<Response> {
  const guard = await requireAdminForWrite(req, permission, db)
  if (!guard.ok) return guard.response
  let body = undefined as unknown as TSchema
  if (bodySchema) {
    const parsed = await parseJsonBody(req, bodySchema)
    if (!parsed.ok) return parsed.response
    body = parsed.data
  }
  try {
    const result = await fn(guard.admin, guard.ctx, body)
    if (result instanceof Response) return result
    if (result && typeof result === "object" && "data" in (result as RouteResult)) {
      const r = result as RouteResult
      return ok(r.data, { status: r.status })
    }
    return ok(result)
  } catch (e) {
    if (e instanceof ContentError) return contentErrorResponse(e)
    return internal(e, ctxLabel)
  }
}

/** 405 兜底（route 文件里给未实现的方法用） */
export function methodNotAllowed(allow: string): Response {
  return methodNotAllow(allow)
}
