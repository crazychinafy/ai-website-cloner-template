// P3：CSRF 防护（安全文档 §4）——组合策略
// 1) SameSite=Lax Cookie（cookies.ts）
// 2) Origin 白名单：同源恒放行；跨源必须命中 ADMIN_ALLOWED_ORIGINS（绝对 URL，禁止 *）
// 3) 写请求要求 X-CSRF-Token 头：= HMAC-SHA256(ADMIN_CSRF_SECRET, 数据库中的 token_hash)
//    —— 由 Session 派生、密钥独立于客户端，持有 Cookie 的跨站者无法计算
// 4) 常量时间比较（timingSafeEqual）
// Host 只读 Host 头（Nginx 按 `proxy_set_header Host $host;` 重写）；不盲信 X-Forwarded-Host。
import "server-only"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i

let devSecret: string | null = null
let devSecretWarned = false

/**
 * CSRF HMAC 密钥：
 * - 显式配置（32-256 位随机串）优先
 * - 生产未配置 → fail-closed 抛错（由 route 兜底为 500 + 明确日志）
 * - 开发未配置 → 每进程随机回退 + 一次性告警（不影响静态前台）
 */
export function getCsrfSecret(): string {
  const v = process.env.ADMIN_CSRF_SECRET
  if (v && v.length >= 32 && v.length <= 256) return v
  if (process.env.NODE_ENV === "production") {
    throw new Error("[admin-csrf] 生产环境必须配置 ADMIN_CSRF_SECRET（32-256 位随机串）")
  }
  if (!devSecret) {
    devSecret = randomBytes(32).toString("base64url")
  }
  if (!devSecretWarned) {
    console.warn("[admin-csrf] ADMIN_CSRF_SECRET 未配置；开发模式使用每进程随机密钥（生产必须显式配置）")
    devSecretWarned = true
  }
  return devSecret
}

/** 解析 Origin 白名单（逗号分隔；绝对 http/https URL；* 直接抛错拒绝启动语义） */
export function allowedOrigins(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_ORIGINS
  if (!raw) return new Set()
  const out = new Set<string>()
  for (const part of raw.split(",")) {
    const o = part.trim().toLowerCase().replace(/\/+$/, "")
    if (!o) continue
    if (o.includes("*")) throw new Error("[admin-csrf] ADMIN_ALLOWED_ORIGINS 不允许通配符 *")
    if (!ORIGIN_RE.test(o)) throw new Error("[admin-csrf] ADMIN_ALLOWED_ORIGINS 必须为绝对 http/https URL")
    out.add(o)
  }
  return out
}

/** 自身 origin：scheme 认 x-forwarded-proto（Nginx 标准设置），host 只取 Host 头 */
function ownOrigin(req: Request): string | null {
  const host = req.headers.get("host")
  if (!host) return null
  const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase()
  const scheme = proto === "https" ? "https" : "http"
  return `${scheme}://${host}`
}

function hostOf(origin: string): string | null {
  const m = origin.match(/^https?:\/\/([^:/]+)(:\d+)?/i)
  return m ? m[1].toLowerCase() : null
}

/**
 * 写请求（POST/PATCH/PUT/DELETE，含登录）的 Origin 校验：
 * - Origin 与自身同源（host 比较，容忍代理端口/ scheme 映射差异）→ 放行
 * - Origin 命中白名单 → 放行
 * - 无 Origin 头：浏览器跨站请求必然携带 Origin，缺失视为同源 → 要求存在 Host 头后放行
 * - 其余 → 拒绝（route 返回 403）
 */
export function isWriteOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin")?.toLowerCase().replace(/\/+$/, "")
  const host = req.headers.get("host")
  if (!origin) return host !== null
  const own = ownOrigin(req)
  if (own && hostOf(own) === hostOf(origin)) return true
  try {
    return allowedOrigins().has(origin)
  } catch {
    return false // 白名单配置非法 → fail-closed
  }
}

/** 由数据库 token_hash 派生 CSRF token（base64url，56 字符） */
export function deriveCsrfToken(tokenHash: string): string {
  return createHmac("sha256", getCsrfSecret()).update(tokenHash).digest("base64url")
}

/** 校验 X-CSRF-Token（常量时间）；tokenHash 必须来自本次验证通过的 Session 行 */
export function verifyCsrfToken(tokenHash: string, provided: string | null): boolean {
  if (!provided) return false
  try {
    const expected = Buffer.from(deriveCsrfToken(tokenHash))
    const given = Buffer.from(provided)
    if (expected.length !== given.length) return false
    return timingSafeEqual(expected, given)
  } catch {
    return false // 密钥未配置等 → fail-closed
  }
}
