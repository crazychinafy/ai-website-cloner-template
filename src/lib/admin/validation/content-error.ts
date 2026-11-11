// P6A：内容管理域业务异常与 Zod 错误映射（Route Handler 统一出口）
// 约定与 auth-service 的 AuthError 对齐：status + code + message + fields。
import "server-only"
import { z } from "zod"
import { err, type AdminErrorCode } from "@/lib/admin/api/response.ts"

/** 内容域业务异常（Service 抛出，Route 捕获后映射为统一信封） */
export class ContentError extends Error {
  constructor(
    public status: number,
    public code: AdminErrorCode,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
    this.name = "ContentError"
  }
}

/** ContentError → 统一错误响应 */
export function contentErrorResponse(e: ContentError): Response {
  return err(e.code, e.message, { status: e.status, fields: e.fields })
}

/**
 * Zod issues → 字段级错误（与 admin-auth-service.zodFields 同规则）：
 * invalid_type（缺失/类型不符）的英文内部消息不透出，统一为中性提示。
 */
export function zodFields(e: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const i of e.issues) {
    const key = i.path.length > 0 ? String(i.path[i.path.length - 1]) : "body"
    const msg = i.code === "invalid_type" ? "参数格式不正确" : i.message
    if (!(key in fields)) fields[key] = msg
  }
  return fields
}

/** Zod 解析失败 → 422 字段错误 */
export function zodErrorResponse(e: z.ZodError): Response {
  return err("VALIDATION_ERROR", "请求参数不正确", { status: 422, fields: zodFields(e) })
}

/** Zod 解析失败 → 可抛出的 ContentError（供 Service 管道内使用，Route 统一捕获） */
export function zodFieldError(e: z.ZodError): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "请求参数不正确", zodFields(e))
}

// ── 常用业务异常工厂 ──────────────────────────────────────────────
export const VERSION_CONFLICT_MESSAGE = "该记录已被其他管理员修改，请刷新后重新编辑"

export function versionConflict(): ContentError {
  return new ContentError(409, "VERSION_CONFLICT", VERSION_CONFLICT_MESSAGE)
}
