// P6C：统一服务端富文本 HTML 净化（文章正文 / 公告正文 / 预览的唯一入口）
// ─────────────────────────────────────────────────────────────────
// 与 P6B 的 validation/html-sanitize.ts（链接详情专用，自研分词器）并存：
// 本模块基于 sanitize-html（成熟 allowlist 解析器，富文本语义更完整：
// 实体规范化、嵌套深度限制、style 属性按声明净化），供 8 个正文触点
// （article/bulletin × create/update/publish/preview）共用；输出幂等
// （对净化结果再净化不产生变化——历史正文「只在真实保存时」经此清洗，
// 不批量重写库内 28 篇存量正文）。
//
// 安全边界（验收 §P6C）：
// - 标签 allowlist：排版/列表/表格/图片/链接；script/style/iframe/svg/form/
//   video/object/embed 等连同内容整体删除；未知标签剥壳留文本
// - 属性 allowlist：无 on* 事件属性；style 仅 color/background-color/font-size
//   且值须匹配安全正则（禁 url()/var()/表达式）；class/id 一律丢弃
// - href/src：策略单一事实源在 validation/media-path.ts（问题 03）——站内只允许
//   受控素材路径（前缀白名单+已知后缀），站外只允许 http(s)（显式开关控制）；
//   拒绝 javascript:/data:/file:/vbscript:/mailto、// 协议相对、反斜杠、.. 穿越与查询串
// - a[target=_blank] 强制 rel="noopener noreferrer"（防 reverse-tabnabbing）
// - 图片不做任何远端抓取（SSRF 面收敛）；嵌套深度上限 32
import "server-only"
import { createHash } from "node:crypto"
import sanitizeHtml from "sanitize-html"
import { ALLOW_EXTERNAL_MEDIA, checkHttpUrl, isControlledMediaPath, squeeze } from "../validation/media-path.ts"

/** 富文本标签 allowlist（小写；编辑器产物 + 历史正文用到的标签） */
const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "sub", "sup", "small", "mark",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
]

/** 属性 allowlist（按标签；title 给 a/img；class/id/data-* 全部丢弃；style 走 allowedStyles 声明级过滤） */
const ALLOWED_ATTRS: Record<string, string[]> = {
  "*": ["style"],
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start"],
  li: ["value"],
}

/** style 属性允许的属性与值（历史正文仅 color/background-color/font-size 一种形态） */
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){2}(,\s*(0|1|0?\.\d+)\s*)?\)$/i
const FONT_SIZE = /^\d{1,3}(\.\d{1,2})?(px|em|rem)$/i
const ALLOWED_STYLES: Record<string, Record<string, RegExp[]>> = {
  "*": {
    color: [HEX_COLOR, RGB_COLOR],
    "background-color": [HEX_COLOR, RGB_COLOR],
    "font-size": [FONT_SIZE],
  },
}

/** 连同内容一起丢弃的标签（内容往往是脚本源码/不可见文本，留下反成噪音或风险） */
const NON_TEXT_TAGS = [
  "script", "style", "textarea", "title", "template", "noscript",
  "iframe", "frame", "object", "embed", "applet", "svg", "math",
  "form", "input", "button", "select", "option", "video", "audio",
  "source", "track", "canvas", "xmp", "plaintext",
]

/** 站内素材策略与 checkHttpUrl 均在 validation/media-path.ts（问题 03：单一事实源） */

/**
 * 图片 src 策略（委托 media-path.ts 统一策略）：站内必须是受控素材路径
 * （根前缀白名单 + 已知图片/视频后缀 + 禁穿越/查询串），站外仅 http(s) 且受
 * ALLOW_EXTERNAL_MEDIA 显式开关控制；拒协议相对 //、data: 等一切其他协议
 * （sanitize-html 协议闸之外的第二道闸）。
 */
export function isSafeMediaSrc(raw: string): boolean {
  const v = squeeze(raw)
  if (!v || v.includes("\\")) return false
  if (v.startsWith("//")) return false
  if (v.startsWith("/")) return isControlledMediaPath(v)
  return ALLOW_EXTERNAL_MEDIA && checkHttpUrl(v) === null
}

/**
 * 链接 href 策略：站内根路径（/articles/... 等）、#片段 或 http(s) 绝对地址。
 * 拒 // 协议相对、mailto: 之外的其他协议、控制字符与反斜杠。
 */
export function isSafeSiteHref(raw: string): boolean {
  const v = squeeze(raw)
  if (!v || v.includes("\\")) return false
  if (v.startsWith("#")) return true
  if (v.startsWith("//")) return false
  if (v.startsWith("/")) return !v.includes("..")
  return checkHttpUrl(v) === null
}

/** 数值属性（img width/height）：纯数字才保留 */
function isNumericAttr(v: string | undefined): boolean {
  return v !== undefined && /^\d{1,6}$/.test(v.trim())
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRS,
  allowedStyles: ALLOWED_STYLES,
  // URL 属性协议闸：只放行 http/https；相对路径默认允许（由 transformTags 二次收紧）
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: NON_TEXT_TAGS,
  nestingLimit: 32,
  parseStyleAttributes: true,
  enforceHtmlBoundary: true,
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.href !== undefined && !isSafeSiteHref(attribs.href)) delete attribs.href
      if (attribs.target !== undefined && attribs.target !== "_blank") delete attribs.target
      if (attribs.target === "_blank") attribs.rel = "noopener noreferrer"
      return { tagName: "a", attribs }
    },
    img: (tagName, attribs) => {
      // 无有效 src 的 <img> 直接丢弃（渲染噪音）；宽高只保留纯数字
      if (attribs.src === undefined || !isSafeMediaSrc(attribs.src)) return { tagName: false as unknown as string, attribs: {} }
      if (attribs.width !== undefined && !isNumericAttr(attribs.width)) delete attribs.width
      if (attribs.height !== undefined && !isNumericAttr(attribs.height)) delete attribs.height
      return { tagName: "img", attribs }
    },
  },
}

/**
 * 富文本正文净化入口：返回可安全入库/回显的 HTML。
 * 幂等：对输出再次调用结果不变（Zod 长度上限在调用方，这里不截断）。
 * 纯文本输入按文本转义返回（前端渲染契约：正文只接受本函数产物）。
 */
export function sanitizeRichHtml(input: string): string {
  // NUL 与 C0/C1 控制字符（保留 \t \n \r）先行删除
  const src = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  if (src.trim() === "") return ""
  return sanitizeHtml(src, SANITIZE_OPTIONS).trim()
}

/**
 * 审计摘要：正文只记长度 + SHA-256（审计表不存全文，见 §11；
 * before/after digest 可判断「正文是否真的变了」）。
 */
export function htmlDigest(html: string): { length: number; sha256: string } {
  return { length: html.length, sha256: createHash("sha256").update(html, "utf8").digest("hex") }
}
