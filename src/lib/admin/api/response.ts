// P3：后台 API 统一响应信封（技术方案 §8）
// 成功 { success: true, data, requestId }；失败 { success: false, error: { code, message, fields? }, requestId }
// 安全约束：任何 5xx 只输出通用文案；错误详情只进服务端日志（防 SQL 错误/堆栈/凭据泄漏）
import { randomUUID } from "node:crypto"

export function newRequestId(): string {
  return randomUUID()
}

export type AdminErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CHANGE_PASSWORD_REQUIRED"
  | "CSRF_INVALID"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  // P6A：内容管理业务错误码（分类/文章分类/标签；409 类为主，前端按 code 精确提示）
  | "VERSION_CONFLICT"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_HAS_LINKS"
  | "CATEGORY_HAS_CHILDREN"
  | "CATEGORY_PARENT_NOT_FOUND"
  | "CATEGORY_PARENT_NOT_LEVEL_ONE"
  | "CATEGORY_CYCLE"
  | "CATEGORY_RESTORE_BLOCKED"
  // P6A.1：父级停用状态 + 恢复名称冲突（409；前缀检查或 UNIQUE 索引兜底竞态）
  | "CATEGORY_PARENT_DISABLED"
  | "CATEGORY_NAME_CONFLICT"
  | "ARTICLE_CATEGORY_NOT_FOUND"
  | "ARTICLE_CATEGORY_HAS_ARTICLES"
  | "ARTICLE_CATEGORY_NAME_CONFLICT"
  | "TAG_NOT_FOUND"
  | "TAG_HAS_LINKS"
  | "TAG_NAME_CONFLICT"
  | "REORDER_SCOPE_MISMATCH"
  | "REORDER_DUPLICATE"
  // P6B：网址管理业务错误码（site_links 聚合：详情 1:1 + 备用链接 1:N）
  | "LINK_NOT_FOUND"
  | "LINK_STATUS_TRANSITION"
  | "LINK_RESTORE_BLOCKED"
  | "LINK_MIRROR_MISMATCH"
  | "LINK_MIRROR_DUPLICATE"
  | "TAG_NOT_USABLE"
  // P6C：文章/公告管理业务错误码（发布状态机 + 软删除恢复 + 批量排序）
  | "ARTICLE_NOT_FOUND"
  | "ARTICLE_STATUS_TRANSITION"
  | "ARTICLE_RESTORE_BLOCKED"
  | "BULLETIN_NOT_FOUND"
  | "BULLETIN_STATUS_TRANSITION"
  // P6D：广告/线路/站点设置业务错误码（投放状态机 + 媒体文件存在性 + 逐 key 乐观锁）
  | "AD_NOT_FOUND"
  | "AD_STATUS_TRANSITION"
  | "LINE_NOT_FOUND"
  | "LINE_STATUS_TRANSITION"
  | "SETTINGS_KEY_UNKNOWN"
  | "SETTINGS_MEDIA_MISSING"

export function ok(data: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return Response.json(
    { success: true, data, requestId: newRequestId() },
    { status: init?.status ?? 200, headers: init?.headers },
  )
}

export function err(
  code: AdminErrorCode,
  message: string,
  init?: { status?: number; retryAfter?: number; fields?: Record<string, string> },
): Response {
  const status = init?.status ?? 500
  const headers: Record<string, string> = {}
  if (init?.retryAfter !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil(init.retryAfter)))
  return Response.json(
    {
      success: false,
      error: { code, message, ...(init?.fields ? { fields: init.fields } : {}) },
      requestId: newRequestId(),
    },
    { status, headers },
  )
}

/** 405：方法与路径不匹配 */
export function methodNotAllow(allow: string): Response {
  return Response.json(
    {
      success: false,
      error: { code: "VALIDATION_ERROR" as const, message: "请求方法不正确" },
      requestId: newRequestId(),
    },
    { status: 405, headers: { Allow: allow } },
  )
}

/**
 * 服务端异常兜底：详情只进日志（可能含 SQL 文本与参数摘要），客户端只得到通用文案。
 * 日志不打印连接串、密码、token。
 */
export function internal(e: unknown, ctx: string): Response {
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  console.error(`[admin-api] ${ctx} failed: ${detail}`)
  return err("INTERNAL_ERROR", "服务暂时不可用，请稍后重试", { status: 500 })
}
