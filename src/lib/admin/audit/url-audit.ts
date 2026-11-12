// P6D：审计 URL 脱敏（§十二-2：URL query 中可能含 token 的参数不进审计）
// 只处理进入 before/after 的 URL 快照：token 类参数的值替换为 ***，其余保留（可追溯）。
const TOKEN_PARAM_RE = /^(?:token|access[-_]?token|auth|auth[-_]?token|apikey|api[-_]?key|secret|session|sid|sig|signature)$/i

/** 审计快照用 URL 形态：query 中 token 类参数值打码（不改公开路径语义） */
export function auditUrl(u: string): string {
  const q = u.indexOf("?")
  if (q === -1) return u
  const base = u.slice(0, q)
  const [query, ...rest] = u.slice(q + 1).split("#")
  const hash = rest.length > 0 ? `#${rest.join("#")}` : ""
  const masked = query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=")
      const name = eq === -1 ? pair : pair.slice(0, eq)
      let decoded = name
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, " "))
      } catch {
        /* 保留原文判定 */
      }
      if (TOKEN_PARAM_RE.test(decoded)) {
        return eq === -1 ? `${name}=***` : `${pair.slice(0, eq + 1)}***`
      }
      return pair
    })
    .join("&")
  return `${base}?${masked}${hash}`
}
