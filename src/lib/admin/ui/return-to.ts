// P5：安全的 returnTo（同构纯函数 —— 不加 "use client"，服务端与客户端均可调用）
// ─────────────────────────────────────────────────────────────────
// - 只允许 /admin 前缀的站内相对路径（拒绝 //、绝对 URL、反斜杠、超长输入）
// - 服务端：/admin/login、/admin/change-password 页面校验 searchParams 后再传客户端
// - 客户端：api-client 401 跳转登录页时拼接 returnTo（由 api-client 再导出本函数）
// - 防御开放重定向（安全文档 §7）；永不信任未校验的查询参数

/** 返回校验后的安全 returnTo；非法输入返回 null（调用方回退默认路径） */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith("/admin")) return null
  if (raw.startsWith("//")) return null
  if (raw.includes("\\")) return null
  if (raw.length > 200) return null
  return raw
}
