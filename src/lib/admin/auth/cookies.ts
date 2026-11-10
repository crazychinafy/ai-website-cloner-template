// P3：管理员 Session Cookie（与前台 facai8_session 完全隔离，SKILL 约束）
// - 名称固定 facai8_admin_session；HttpOnly（JS 不可读）、SameSite=Lax、Path=/
// - Secure 仅 production；Max-Age 与数据库 expires_at 一致（同一 TTL 常量计算）
// - 不设置 Domain（仅当前 host）
import "server-only"

export const ADMIN_SESSION_COOKIE = "facai8_admin_session"

function secureFlag(): boolean {
  return process.env.NODE_ENV === "production"
}

/** 序列化携带 session 的 Cookie（set-cookie 头值） */
export function serializeSessionCookie(token: string, maxAgeSec: number): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(1, Math.floor(maxAgeSec))}`,
  ]
  if (secureFlag()) parts.push("Secure")
  return parts.join("; ")
}

/** 序列化清空 Cookie（注销） */
export function serializeClearedSessionCookie(): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]
  if (secureFlag()) parts.push("Secure")
  return parts.join("; ")
}

/**
 * 从 Cookie 请求头解析管理员 token（唯一来源）。
 * token = base64url(32 随机字节) = 43 字符；超长/非法直接拒绝。
 */
export function parseAdminToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=")
    if (i < 0) continue
    if (part.slice(0, i).trim() !== ADMIN_SESSION_COOKIE) continue
    const v = part.slice(i + 1).trim()
    if (v.length === 0 || v.length > 256) return null
    return v
  }
  return null
}
