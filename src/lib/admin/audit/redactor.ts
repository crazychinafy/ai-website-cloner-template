// P7：统一脱敏器（写入与读取共用同一规则 —— 单一实现，双时机执行）
// ─────────────────────────────────────────────────────────────────
// 适用面：审计 before/after JSON（写入时 + 读取时）、错误文本（errorSummary）、
//         未来任何进入 admin_audit_logs / API 响应的动态 JSON。
// 规则（§10.3）：
//   - 敏感 key（password/token/secret/session/cookie/authorization/csrf/api_key/credential/...）→ "***"
//   - 递归处理对象与数组（含嵌套）；保留结构与键名，只替换值 —— 绝不改写数据库行
//   - 字符串值内容再清洗：URL query token 参数、Authorization/Cookie 头样式、
//     key=value / key:value 凭据、连接串 //user:pass@ 口令
//   - 防御上限：深度 / 每层条目数 / 字符串长度（超限截断并标注）
//   - 循环引用 → "[循环引用]"
//   - fail-closed：脱敏自身抛错时整值替换为占位对象，绝不回退原文
import "server-only"

export const REDACT_MASK = "***"

export const REDACT_DEPTH_LIMIT = 16
export const REDACT_LIST_LIMIT = 200
export const REDACT_STRING_LIMIT = 8_192

/** key 名敏感判定（小写包含式，覆盖 tokenHash / sessionToken / rawPassword 等派生名） */
const SECRET_KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "cookie",
  "authorization",
  "csrf",
  "credential",
  "api_key",
  "apikey",
  "access_key",
  "accesskey",
  "private_key",
  "privatekey",
  "passphrase",
  "session",
  "signature",
] as const

/** 独立成词即敏感的短 key（大小写不敏感精确匹配） */
const SECRET_KEY_EXACT = new Set(["pin", "otp", "auth"])

export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase()
  if (SECRET_KEY_EXACT.has(k)) return true
  return SECRET_KEY_SUBSTRINGS.some((s) => k.includes(s))
}

/**
 * 字符串内容清洗：URL query 凭据参数、头样式、key=value、DSN 口令。
 * 顺序执行多轮替换；单项失败不影响其余（无 throw 路径）。
 */
export function scrubText(value: string): string {
  let s = value
  // JSON 形态："password": "x" / "api_key":"x"（引号包裹的 key 与分隔符之间还有引号）
  s = s.replace(
    /("(?:[a-z0-9_]*(?:password|passwd|pwd|secret|token|api_?key|access_?key|private_?key|credential|passphrase|session|authorization|cookie|csrf)[a-z0-9_]*)")\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,}\]]+)/gi,
    (_m, p1: string) => `${p1}: ${REDACT_MASK}`,
  )
  // URL query 中名称含凭据语义的参数值：?token=x&password=y&api_key=z&signature=w
  s = s.replace(
    /([?&][a-z0-9_]*(?:token|password|passwd|pwd|secret|api_?key|access_?key|signature|auth)[a-z0-9_]*)=([^&#\s]*)/gi,
    (_m, p1: string) => `${p1}=${REDACT_MASK}`,
  )
  // 头样式：Authorization: Bearer xxx / Cookie: a=b; c=d / X-CSRF-Token: xxx（到行尾）
  s = s.replace(/((?:authorization|cookie|x-csrf-token)\s*[:=]\s*)[^\r\n]*/gi, (_m, p1: string) => `${p1}${REDACT_MASK}`)
  // key=value / key: value 凭据（文本/日志/连接串常见形态；含引号包裹的值 "pass=xxx"）
  s = s.replace(
    /([a-z0-9_]*(?:password|passwd|pwd|secret|token|api_?key|access_?key|private_?key|credential|passphrase)[a-z0-9_]*)\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,&;"']+)/gi,
    (_m, p1: string) => `${p1}=${REDACT_MASK}`,
  )
  // 连接串用户口令：mysql://user:pass@host / //user:pass@
  s = s.replace(/(\/\/[^\s/:@]+:)[^\s@]{1,}@/g, `$1${REDACT_MASK}@`)
  return s
}

function truncatedString(v: string): string {
  return v.length > REDACT_STRING_LIMIT ? `${v.slice(0, REDACT_STRING_LIMIT)}…[已截断]` : v
}

function redactWalk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return truncatedString(scrubText(value))
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return scrubText(value.toString())
  if (typeof value !== "object") return scrubText(String(value))

  if (depth >= REDACT_DEPTH_LIMIT) return "[已截断：超过最大深度]"
  if (seen.has(value)) return "[循环引用]"
  seen.add(value)

  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < Math.min(value.length, REDACT_LIST_LIMIT); i++) {
      out.push(redactWalk(value[i], depth + 1, seen))
    }
    if (value.length > REDACT_LIST_LIMIT) out.push(`[已截断：共 ${value.length} 项]`)
    return out
  }
  if (value instanceof Date) return scrubText(value.toISOString())
  if (Buffer.isBuffer(value)) return `[binary ${value.length}B]`

  const src = value as Record<string, unknown>
  const keys = Object.keys(src)
  const out: Record<string, unknown> = {}
  for (let i = 0; i < Math.min(keys.length, REDACT_LIST_LIMIT); i++) {
    const k = keys[i]!
    out[k] = isSecretKey(k) ? REDACT_MASK : redactWalk(src[k], depth + 1, seen)
  }
  if (keys.length > REDACT_LIST_LIMIT) out["[已截断]"] = `共 ${keys.length} 个键`
  return out
}

/**
 * 脱敏一个任意 JSON 值（审计 before/after、快照对象）。
 * 返回深拷贝的结构化结果（键序保留、结构不变、敏感处替换）。
 * fail-closed：任何异常 → 占位对象（原文绝不外泄）。
 */
export function redactAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  try {
    return redactWalk(value, 0, new WeakSet<object>())
  } catch {
    return { redacted: true, note: "脱敏失败，原值已隐藏" }
  }
}

/** 错误/异常文本脱敏（errorSummary 等；同时限制总长度） */
export function redactErrorText(text: string, maxLen = 2_000): string {
  try {
    return truncatedString(scrubText(String(text ?? ""))).slice(0, maxLen)
  } catch {
    return "脱敏失败，原文已隐藏"
  }
}
