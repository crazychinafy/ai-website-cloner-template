"use client"

// P6C：极简自研富文本编辑器（文章/公告正文共用）
// ─────────────────────────────────────────────────────────────────
// 设计约束（§P6C）：不引入第三方编辑器；只产出净化器 allowlist 内的 HTML。
// - contentEditable + document.execCommand（成熟但废弃的编辑 API；浏览器长期兼容）
// - 工具栏：撤销/重做 | 段落/H2/H3/H4 | 粗/斜/下划线/删除线 | 引用/有序/无序 | 链接/图片 | 预览
// - 历史栈：commit 快照（命令后、input 防抖后、IME composition 结束后）；
//   composition 期间不截断 DOM，中/日文输入不被破坏
// - 粘贴：HTML 走本地 allowlist 清洗后插入（保留排版）；纯文本按纯文本插入
// - 图片：src + 替代文字表单（src 必须是站内素材路径或 http(s)），产出 <figure><img/><figcaption/></figure>
// - 「HTML 预览」按钮：把当前内容 POST /articles/preview（或公告预览）→ 弹窗展示【服务端净化后】的 HTML
//   —— 让编辑者所见即入库所得；安全边界始终在服务端 sanitizer。
import * as React from "react"
import {
  Bold,
  Code,
  Eye,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ── 本地 HTML 小工具（仅用于粘贴清洗与命令前后快照；非安全边界）──────
const RICH_TAGS = new Set([
  "p", "br", "hr", "div", "span", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "del",
  "ul", "ol", "li", "blockquote", "a", "img", "figure", "figcaption",
])
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

/** 粘贴 HTML 本地清洗：未知标签剥壳留文本；属性按标签白名单；href/src 粗校验。 */
export function sanitizePastedHtml(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|svg|form|input|object|embed|video|audio|textarea)[\s\S]*?<\/\1>/gi, "")
    .replace(TAG_RE, (m0, tag: string, attrs: string) => {
      const name = tag.toLowerCase()
      if (!RICH_TAGS.has(name)) return ""
      const isClose = m0.startsWith("</")
      const isSelf = m0.endsWith("/>")
      if (isClose) return `</${name}>`
      const kept: string[] = []
      for (const am of (attrs ?? "").matchAll(ATTR_RE)) {
        const key = am[1].toLowerCase()
        const val = (am[2] ?? am[3] ?? am[4] ?? "").trim()
        if (name === "a" && key === "href" && /^(https?:\/\/|\/(?!\/)|#)/i.test(val) && !val.includes("..")) kept.push(`href="${escapeAttr(val)}"`)
        if (name === "img" && key === "src" && /^(https?:\/\/|\/(?!\/))/i.test(val) && !val.includes("..")) kept.push(`src="${escapeAttr(val)}"`)
        if (name === "img" && key === "alt") kept.push(`alt="${escapeAttr(val)}"`)
      }
      return `<${name}${kept.length ? ` ${kept.join(" ")}` : ""}${isSelf && name === "img" ? "" : ""}>`
    })
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 图片 src 编辑端粗校验（与服务端 isSafeMediaSrc 同口径的 UI 提示，服务端仍是最终闸） */
export function looksLikeSafeMediaSrc(raw: string): boolean {
  const v = raw.trim()
  if (/^https?:\/\/\S+$/i.test(v) && !v.includes("..") && !v.includes("\\")) return true
  return /^\/(uploads|sites|images|videos|media)\/[^\s\\]*$/.test(v) && !v.includes("..")
}

/** 链接 href 编辑端粗校验 */
export function looksLikeSafeHref(raw: string): boolean {
  const v = raw.trim()
  if (!v) return false
  if (v.startsWith("#")) return true
  if (v.startsWith("//")) return false
  if (v.startsWith("/")) return !v.includes("..") && !v.includes("\\")
  return /^https?:\/\/\S+$/i.test(v) && !v.includes("\\")
}

// ── 编辑器 ──────────────────────────────────────────────────────
interface Props {
  id: string
  /** 初始 HTML（挂载时灌入一次；之后由编辑器接管） */
  initialHtml: string
  onChange: (html: string) => void
  disabled?: boolean
  error?: string | null
  /** 传入则显示「HTML 预览」按钮：内容由调用方送服务端净化后回显 */
  onRequestPreview?: (html: string) => Promise<void>
  previewBusy?: boolean
  ariaLabel?: string
}

const HISTORY_LIMIT = 100

export function RichTextEditor({ id, initialHtml, onChange, disabled = false, error, onRequestPreview, previewBusy = false, ariaLabel = "正文编辑器" }: Props) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const composingRef = React.useRef(false)
  const historyRef = React.useRef<{ stack: string[]; index: number }>({ stack: [""], index: 0 })
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canUndo, setCanUndo] = React.useState(false)
  const [canRedo, setCanRedo] = React.useState(false)
  const mountedRef = React.useRef(false)

  const syncHistoryFlags = React.useCallback(() => {
    const h = historyRef.current
    setCanUndo(h.index > 0)
    setCanRedo(h.index < h.stack.length - 1)
  }, [])

  const currentHtml = () => ref.current?.innerHTML ?? ""

  const commit = React.useCallback(
    (html: string) => {
      const h = historyRef.current
      const cur = h.stack[h.index]
      if (cur === html) return
      h.stack = h.stack.slice(0, h.index + 1)
      h.stack.push(html)
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift()
      h.index = h.stack.length - 1
      syncHistoryFlags()
      onChange(html)
    },
    [onChange, syncHistoryFlags],
  )

  // 挂载：灌入初始 HTML（此后 initialHtml 变化不再覆盖，避免保存后回写打断光标）
  React.useEffect(() => {
    if (mountedRef.current || !ref.current) return
    mountedRef.current = true
    ref.current.innerHTML = initialHtml
    historyRef.current = { stack: [initialHtml], index: 0 }
    syncHistoryFlags()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = React.useCallback(
    (command: string, arg?: string) => {
      const el = ref.current
      if (!el || disabled) return
      el.focus()
      try {
        document.execCommand(command, false, arg)
      } catch {
        /* execCommand 在部分浏览器对个别命令抛错：忽略，内容仍由 input 事件收敛 */
      }
      commit(currentHtml())
    },
    [commit, disabled],
  )

  function onInput() {
    if (composingRef.current) return // IME 合成期间不提交（中文输入不被打断）
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => commit(currentHtml()), 400)
  }

  function onCompositionEnd() {
    composingRef.current = false
    onInput()
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const html = e.clipboardData.getData("text/html")
    const text = e.clipboardData.getData("text/plain")
    if (html) document.execCommand("insertHTML", false, sanitizePastedHtml(html))
    else if (text) document.execCommand("insertText", false, text)
    commit(currentHtml())
  }

  function undo() {
    const h = historyRef.current
    if (h.index <= 0 || !ref.current) return
    h.index -= 1
    ref.current.innerHTML = h.stack[h.index] ?? ""
    syncHistoryFlags()
    onChange(h.stack[h.index] ?? "")
  }

  function redo() {
    const h = historyRef.current
    if (h.index >= h.stack.length - 1 || !ref.current) return
    h.index += 1
    ref.current.innerHTML = h.stack[h.index] ?? ""
    syncHistoryFlags()
    onChange(h.stack[h.index] ?? "")
  }

  // ── 链接表单 ──
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkUrl, setLinkUrl] = React.useState("")
  const [linkErr, setLinkErr] = React.useState<string | null>(null)
  const savedRangeRef = React.useRef<Range | null>(null)

  function saveRange() {
    const sel = document.getSelection()
    savedRangeRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
  }
  function restoreRange() {
    const el = ref.current
    if (!el || !savedRangeRef.current) return
    el.focus()
    const sel = document.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRangeRef.current)
  }

  function openLinkDialog() {
    if (disabled) return
    const sel = document.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setLinkErr("请先选中要加链接的文字")
      setLinkOpen(true)
      return
    }
    saveRange()
    setLinkUrl("")
    setLinkErr(null)
    setLinkOpen(true)
  }

  function applyLink() {
    const url = linkUrl.trim()
    if (!looksLikeSafeHref(url)) {
      setLinkErr("链接必须是 http(s) 地址、站内路径（/ 开头）或 #片段")
      return
    }
    restoreRange()
    document.execCommand("createLink", false, url)
    // target=_blank + rel：对 http(s) 外链补齐（服务端 sanitizer 同样兜底）
    commit(currentHtml())
    setLinkOpen(false)
  }

  // ── 图片表单 ──
  const [imgOpen, setImgOpen] = React.useState(false)
  const [imgSrc, setImgSrc] = React.useState("")
  const [imgAlt, setImgAlt] = React.useState("")
  const [imgErr, setImgErr] = React.useState<string | null>(null)

  function applyImage() {
    const src = imgSrc.trim()
    if (!looksLikeSafeMediaSrc(src)) {
      setImgErr("图片地址必须是站内素材路径（/uploads/ 等）或 http(s) 链接")
      return
    }
    const alt = imgAlt.trim().replace(/"/g, "&quot;")
    const figcaption = alt ? `<figcaption>${alt.replace(/</g, "&lt;")}</figcaption>` : ""
    document.execCommand("insertHTML", false, `<figure><img src="${escapeAttr(src)}" alt="${alt}"/>${figcaption}</figure><p><br/></p>`)
    commit(currentHtml())
    setImgOpen(false)
    setImgSrc("")
    setImgAlt("")
  }

  function setBlock(tag: string) {
    exec("formatBlock", `<${tag}>`)
  }

  const ToolBtn = ({
    label,
    onClick,
    active,
    iconOf: Icon,
    disabled: d,
  }: {
    label: string
    onClick: () => void
    active?: boolean
    iconOf: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
    disabled?: boolean
  }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      disabled={disabled || d}
      onClick={onClick}
      className={cn(
        "adm-btn inline-flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors outline-none",
        "hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-muted text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )

  return (
    <div className={cn("rounded-lg border bg-card", error ? "border-destructive/60" : "border-border")}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5" role="toolbar" aria-label="正文格式工具栏">
        <ToolBtn label="撤销" iconOf={Undo2} onClick={undo} disabled={!canUndo} />
        <ToolBtn label="重做" iconOf={Redo2} onClick={redo} disabled={!canRedo} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolBtn label="正文段落" iconOf={Type} onClick={() => setBlock("p")} />
        <ToolBtn label="二级标题" iconOf={Heading2} onClick={() => setBlock("h2")} />
        <ToolBtn label="三级标题" iconOf={Heading3} onClick={() => setBlock("h3")} />
        <ToolBtn label="四级标题" iconOf={Heading4} onClick={() => setBlock("h4")} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolBtn label="加粗" iconOf={Bold} onClick={() => exec("bold")} />
        <ToolBtn label="斜体" iconOf={Italic} onClick={() => exec("italic")} />
        <ToolBtn label="下划线" iconOf={Underline} onClick={() => exec("underline")} />
        <ToolBtn label="删除线" iconOf={Strikethrough} onClick={() => exec("strikeThrough")} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolBtn label="引用" iconOf={Quote} onClick={() => setBlock("blockquote")} />
        <ToolBtn label="有序列表" iconOf={ListOrdered} onClick={() => exec("insertOrderedList")} />
        <ToolBtn label="无序列表" iconOf={List} onClick={() => exec("insertUnorderedList")} />
        <ToolBtn label="分隔线" iconOf={Minus} onClick={() => exec("insertHorizontalRule")} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolBtn label="插入链接" iconOf={Link2} onClick={openLinkDialog} />
        <ToolBtn label="取消链接" iconOf={Unlink} onClick={() => exec("unlink")} />
        <ToolBtn label="插入图片" iconOf={Code} onClick={() => !disabled && (setImgErr(null), setImgOpen(true))} />
        {onRequestPreview ? (
          <button
            type="button"
            disabled={previewBusy}
            onClick={() => void onRequestPreview(currentHtml())}
            className="adm-btn adm-touch-target ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {previewBusy ? <Loader className="size-3.5 animate-spin" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            HTML 预览
          </button>
        ) : null}
      </div>

      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={onCompositionEnd}
        onPaste={onPaste}
        className={cn(
          "adm-prose min-h-64 max-w-none px-4 py-3 text-sm leading-7 text-foreground outline-none",
          disabled && "cursor-not-allowed bg-muted/40 text-muted-foreground",
        )}
      />

      {/* 链接表单 */}
      {linkOpen ? (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-link-url`} className="text-xs font-medium text-foreground">
              链接地址
            </label>
            <input
              id={`${id}-link-url`}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyLink()}
              placeholder="https://example.com 或 /articles/123"
              className="adm-input h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              autoFocus
            />
            <button
              type="button"
              onClick={applyLink}
              className="adm-btn adm-touch-target inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              确定
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(false)}
              className="adm-btn adm-touch-target inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              取消
            </button>
          </div>
          {linkErr ? <p className="mt-1.5 text-xs text-destructive">{linkErr}</p> : null}
        </div>
      ) : null}

      {/* 图片表单 */}
      {imgOpen ? (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-img-src`} className="text-xs font-medium text-foreground">
              图片地址
            </label>
            <input
              id={`${id}-img-src`}
              value={imgSrc}
              onChange={(e) => setImgSrc(e.target.value)}
              placeholder="/uploads/xxx.webp 或 https://cdn.example/img.png"
              className="adm-input h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              autoFocus
            />
            <label htmlFor={`${id}-img-alt`} className="text-xs font-medium text-foreground">
              替代文字
            </label>
            <input
              id={`${id}-img-alt`}
              value={imgAlt}
              onChange={(e) => setImgAlt(e.target.value)}
              placeholder="可留空"
              className="adm-input h-8 w-40 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={applyImage}
              className="adm-btn adm-touch-target inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              插入
            </button>
            <button
              type="button"
              onClick={() => setImgOpen(false)}
              className="adm-btn adm-touch-target inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              取消
            </button>
          </div>
          {imgErr ? <p className="mt-1.5 text-xs text-destructive">{imgErr}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
