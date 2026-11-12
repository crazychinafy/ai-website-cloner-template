// 媒体路径统一策略（P6C 整改·问题 03）——所有「图片/视频引用」校验的单一事实源
// ─────────────────────────────────────────────────────────────────
// 字段级校验（mediaPathSchema：封面图/作者头像/Logo/预览图）、富文本 Sanitizer
// （security/html-sanitizer.ts 的 img src）与富文本编辑器前端（RichTextEditor）
// 共用本模块，消除「各自维护一套 allowlist」的政策漂移。
// 本文件必须可被客户端 import：不要引入 server-only / node: 模块。
//
// 明确的安全策略（而非默认放行）：
// - 站内受控素材：必须以白名单根前缀开头（与 asset()/public/ 目录布局一致）、
//   禁反斜杠与控制字符、禁协议相对 //、禁查询串/hash、无 . 与 .. 段（禁路径
//   穿越）、后缀限定为已知图片/视频类型（历史正文实际形态：/uploads/<日期>/<hash>.png|jpg）
// - 站外 http(s) 绝对链接：由显式开关 ALLOW_EXTERNAL_MEDIA 控制——历史快照存在
//   1 条绝对 Logo、编辑正文需粘贴站外图；仍过 checkHttpUrl 硬校验（拒 userinfo/
//   非法主机名/控制字符），服务端不做任何远端抓取（SSRF 禁令）；前台渲染另有
//   CSP img-src 'self' data: https: 兜底
// - 协议相对 //、data:、file: 等其余协议一律拒绝（与富文本 Sanitizer 口径一致）
// - 文件存在性：服务端不校验——仓库引用了未落盘的 /uploads/** 历史路径（做存在
//   性校验会误伤全部历史数据）；素材落盘与存在性盘点属 P6D 素材接入范围

/** 站内受控素材根路径前缀（与 asset()/public/ 目录布局一致） */
export const MEDIA_PATH_PREFIXES = ["/uploads/", "/sites/", "/images/", "/videos/", "/media/"] as const

/** 是否允许站外 http(s) 媒体引用（显式安全开关；false = 只允许站内受控素材路径） */
export const ALLOW_EXTERNAL_MEDIA = true

/** 允许的媒体文件后缀（历史数据实际形态 + 编辑器粘贴常见类型） */
const MEDIA_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4)$/i

const CONTROL_RE = /[\u0000-\u0020\u007f]/
const URL_BAD_CHAR_RE = /[<>"'`\\\s]/

/** 校验 URL 结构（调用方保证已 trim/长度）；返回 issue 文案或 null */
export function checkHttpUrl(v: string, label = "地址"): string | null {
  if (CONTROL_RE.test(v)) return `${label}包含非法控制字符`
  if (URL_BAD_CHAR_RE.test(v)) return `${label}包含非法字符`
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return `${label}必须是完整的 http(s) 链接`
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "只允许 http / https 协议"
  if (u.username || u.password) return `${label}不能包含账号密码`
  const host = u.hostname
  if (!host || host.length > 253) return `${label}主机名不合法`
  if (!/^[a-z0-9.\-[\]:]+$/.test(host)) return `${label}主机名包含非法字符`
  return null
}

/** 去掉控制/空白字符后的形态（防 "java\nscript:" 之类拆分注入） */
export function squeeze(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim()
}

/** 是否为已知图片/视频后缀 */
export function hasKnownMediaExt(v: string): boolean {
  return MEDIA_EXT_RE.test(v)
}

/**
 * 站内受控媒体路径判定：根前缀白名单 + 禁反斜杠/控制字符/协议相对/查询串/hash
 * + 无 . 与 .. 段 + 已知后缀。这是「站内图片」的唯一闸（字段与正文共用）。
 */
export function isControlledMediaPath(v: string): boolean {
  if (!v.startsWith("/") || v.startsWith("//")) return false
  if (v.includes("\\")) return false
  if (CONTROL_RE.test(v)) return false
  if (v.includes("?") || v.includes("#")) return false
  if (v.split("/").some((seg) => seg === "." || seg === "..")) return false
  if (!MEDIA_PATH_PREFIXES.some((p) => v.startsWith(p))) return false
  return MEDIA_EXT_RE.test(v)
}

/**
 * 统一媒体引用校验入口（空串 = 无图，直接通过）；返回 issue 文案，null = 通过。
 * mediaPathSchema（Zod）与需要同源策略的调用方都走这里。
 */
export function mediaSrcError(v: string, label: string): string | null {
  if (v === "") return null
  if (CONTROL_RE.test(v) || v.includes("\\")) return `${label}包含非法字符`
  if (v.startsWith("//")) return `${label}不支持协议相对链接（// 开头）`
  if (/^https?:\/\//i.test(v)) {
    if (!ALLOW_EXTERNAL_MEDIA) return `${label}不允许站外链接（当前策略：仅站内受控素材路径）`
    return checkHttpUrl(v, label)
  }
  if (v.startsWith("/")) {
    return isControlledMediaPath(v)
      ? null
      : `${label}必须是站内受控素材路径（以 ${MEDIA_PATH_PREFIXES.join("、")} 之一开头，已知图片/视频后缀，禁 .. 穿越与查询串）`
  }
  return `${label}必须是站内路径（/ 开头）或 http(s) 链接`
}
