// P6B：服务端富文本 HTML 清洗（detailHtml 入库前净化）
// ─────────────────────────────────────────────────────────────────
// 背景：详情 HTML 最终由前台 dangerouslySetInnerHTML 渲染（LinkDetail/ArticleDetail），
// 源站在客户端用 DOMPurify 净化；后台写入必须服务端净化，否则 XSS 直接入库。
// 本模块是仓库第一个服务端 HTML 清洗器（无第三方依赖，allowlist 分词器实现），
// P6C（文章/公告富文本）直接复用。
//
// 规则（保守 allowlist）：
// - 标签：只保留排版/表格/图片/链接白名单；script/style/textarea 等连同内容整体删除；
//   其他未知标签只剥掉标签本身、保留（转义后的）文本内容
// - 属性：按标签白名单；on* 事件属性、style、srcset/form/action 等一律丢弃；
//   href/src 只允许 http(s)/mailto/站内根路径（拒绝 javascript:/data:/vbscript:/file: 协议）
// - 注释、CDATA、PI、未闭合的 < 全部删除或按文本转义
// - 控制字符（含 NUL）删除；文本段整体转义（保留既有 &entity; 写法不双重转义）
// 性能：详情正文最长几 KB（实库 max < 1KB），单遍线性扫描即可，不需要完整 DOM 解析。

/** 保留的标签集合（小写） */
const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "ins",
  "sub", "sup", "small", "mark", "big", "font", "center",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "pre", "code",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
])

/** 连同内容一起删除的标签（内容里往往是脚本/原始文本，保留反而危险） */
const DROP_WITH_CONTENT = new Set(["script", "style", "textarea", "title", "template", "noscript", "iframe", "object", "embed", "svg", "math", "form", "select", "option", "button", "input"])

/** 全局安全属性 + 按标签追加的属性（全部小写） */
const GLOBAL_ATTRS = new Set(["class", "title", "dir", "lang"])
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "name", "id"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding", "referrerpolicy"]),
  th: new Set(["colspan", "rowspan", "align", "valign", "scope"]),
  td: new Set(["colspan", "rowspan", "align", "valign"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  table: new Set(["width", "border", "cellpadding", "cellspacing", "align"]),
  hr: new Set(["width", "size", "align", "noshade"]),
  font: new Set(["color", "size", "face"]),
  h1: new Set(["align"]), h2: new Set(["align"]), h3: new Set(["align"]),
  h4: new Set(["align"]), h5: new Set(["align"]), h6: new Set(["align"]),
  li: new Set(["value"]), ol: new Set(["start", "type"]), ul: new Set(["type"]),
  div: new Set(["align"]), p: new Set(["align"]), blockquote: new Set(["cite"]),
  span: new Set(["align"]), pre: new Set(["width"]), caption: new Set(["align"]),
  tr: new Set(["align", "valign", "bgcolor"]), tbody: new Set(["align", "valign"]),
  figure: new Set(["class"]), center: new Set(), big: new Set(), small: new Set(), mark: new Set(),
}

/** 需要 URL 校验的属性 */
const URL_ATTRS = new Set(["href", "src", "cite"])

/** 自闭合（无结束标签） */
const VOID_TAGS = new Set(["br", "hr", "img", "col", "wbr"])

/** 属性名 token（attr=value 解析） */
const ATTR_RE = /([a-zA-Z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]*)))?/g

/** URL 安全性：http/https/mailto、根路径或 #fragment（拒绝 javascript:/data:/file:/vbscript: 等） */
export function isSafeContentUrl(raw: string): boolean {
  const v = raw.trim().replace(/[\u0000-\u0020\u007f]+/g, "") // 去控制/空白（防 "java\nscript:" 拆分）
  if (!v) return false
  if (v.startsWith("/") && !v.startsWith("//")) return true // 站内绝对路径
  if (v.startsWith("#")) return true
  if (/^\/\//.test(v)) return true // 协议相对（浏览器按 https 解析，前台同源部署）
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v)
  if (!m) return true // 无协议：相对路径（如 uploads/...png）
  const scheme = m[1].toLowerCase()
  return scheme === "http" || scheme === "https" || scheme === "mailto"
}

function decodeBasicEntities(v: string): string {
  return v
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
}

function escapeText(v: string): string {
  // 只转义 & 后面不是既有实体形态的情况（保留 &nbsp; 之类源站写法）
  return v
    .replace(/&(?!#?\w{1,8};)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

/** 属性值净化：URL 属性做协议校验，其余保留文本（输出时转义）；null = 丢弃 */
function cleanAttrValue(tag: string, name: string, value: string): string | null {
  if (URL_ATTRS.has(name)) {
    return isSafeContentUrl(decodeBasicEntities(value)) ? value.trim() : null
  }
  return value
}

/**
 * 清洗入口：返回净化后的 HTML（可能与输入不同；纯空白输入 → ""）。
 * 输入长度上限由 Zod 负责（防 64KB 请求体溢出），这里只做净化不做截断。
 */
export function sanitizeDetailHtml(input: string): string {
  // 控制字符（保留 \t \n \r）；NUL 注入是经典绕过硬措施
  const src = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  const out: string[] = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf("<", i)
    if (lt < 0) {
      out.push(escapeText(src.slice(i)))
      break
    }
    out.push(escapeText(src.slice(i, lt)))
    // 注释 / CDATA / PI：整体删除
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4)
      i = end < 0 ? src.length : end + 3
      continue
    }
    if (src.startsWith("<![", lt)) {
      const end = src.indexOf("]]>", lt + 3)
      i = end < 0 ? src.length : end + 3
      continue
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    const tagNameMatch = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(src.slice(lt))
    if (!tagNameMatch) {
      // 孤立的 <（如 "a < b"）→ 按文本转义
      out.push("&lt;")
      i = lt + 1
      continue
    }
    const tag = tagNameMatch[1].toLowerCase()
    const isClose = src[lt + 1] === "/"
    // 找到未引号包裹属性里的 >（跳过引号段）
    let j = lt + tagNameMatch[0].length
    let quote: string | null = null
    let gt = -1
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === ">") {
        gt = j
        break
      }
    }
    if (gt < 0) {
      // 未闭合标签：整个尾部丢弃（残缺片段没有渲染价值）
      break
    }
    const inner = src.slice(lt + (isClose ? 2 : 1), gt).replace(/\/$/, "")
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!isClose && !VOID_TAGS.has(tag)) {
        // 跳到匹配的结束标签（不存在则丢到末尾）
        const closeIdx = findCloseTag(src, tag, gt + 1)
        i = closeIdx < 0 ? src.length : closeIdx
      } else {
        i = gt + 1
      }
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 未知标签：剥掉标签 token，保留其中的文本（后续循环正常转义）
      i = gt + 1
      continue
    }
    if (isClose) {
      out.push(`</${tag}>`)
      i = gt + 1
      continue
    }
    const selfClose = inner.endsWith("/")
    const attrSrc = selfClose ? inner.slice(0, -1) : inner
    const attrs = renderAttrs(tag, attrSrc.slice(tagNameMatch[1].length))
    out.push(selfClose && !VOID_TAGS.has(tag) ? `<${tag}${attrs} />` : `<${tag}${attrs}>`)
    i = gt + 1
  }
  return out.join("").trim()
}

/** 在 src[from..] 找 `</tag`（大小写不敏感），返回该结束标签起始下标；找不到 -1 */
function findCloseTag(src: string, tag: string, from: number): number {
  const lower = src.toLowerCase()
  let k = from
  for (;;) {
    const idx = lower.indexOf(`</${tag}`, k)
    if (idx < 0) return -1
    const after = idx + tag.length + 2
    if (after >= src.length || !/[a-zA-Z0-9]/.test(src[after])) return idx
    k = after
  }
}

/** 解析并输出标签属性（白名单 + URL 校验 + 转义）；丢弃 on* 与未知属性 */
function renderAttrs(tag: string, raw: string): string {
  const allowed = TAG_ATTRS[tag]
  const parts: string[] = []
  const seen = new Set<string>()
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(raw)) !== null) {
    const name = m[1].toLowerCase()
    if (seen.has(name)) continue
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name.startsWith("on")) continue // 事件属性一律丢弃
    if (!GLOBAL_ATTRS.has(name) && !(allowed && allowed.has(name))) continue
    const cleaned = cleanAttrValue(tag, name, value)
    if (cleaned === null) continue
    seen.add(name)
    parts.push(`${name}="${escapeAttr(cleaned)}"`)
  }
  // a[target] 强制 noopener（防 reverse-tabnabbing）
  if (tag === "a" && seen.has("target")) {
    const idx = parts.findIndex((p) => p.startsWith('target="'))
    const relIdx = parts.findIndex((p) => p.startsWith("rel="))
    if (idx >= 0) {
      if (relIdx < 0) parts.push('rel="noopener noreferrer"')
      else if (!/noopener/.test(parts[relIdx])) parts[relIdx] = 'rel="noopener noreferrer"'
    }
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : ""
}
