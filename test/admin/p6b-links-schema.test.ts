// P6B §14.3 网址 Zod schema + 服务端 HTML 净化（纯函数，无库）
// - URL scheme 校验：只允许 http/https；拒绝 javascript:/data:/file:/vbscript:、账号密码、控制字符
// - Logo/预览图：空 / 站内 / 路径 / http(s) 绝对（历史快照兼容）；拒绝 // 与裸相对路径
// - 聚合 PATCH 合同：空 patch 拒绝；detail null；mirrors 全量替换（id 去重）
// - 净化器：XSS 载荷无法存活（script/事件属性/javascript: href/注释/控制字符注入）
import { describe, expect, it } from "vitest"
import {
  checkHttpUrl,
  createLinkSchema,
  httpUrlSchema,
  linkListQuerySchema,
  linkStatusChangeSchema,
  mediaPathSchema,
  updateLinkSchema,
} from "../../src/lib/admin/validation/link-schema.ts"
import { isSafeContentUrl, sanitizeDetailHtml } from "../../src/lib/admin/validation/html-sanitize.ts"

function okUrl(v: string): boolean {
  return httpUrlSchema.safeParse(v).success
}

describe("P6B URL 校验（httpUrlSchema）", () => {
  it("接受 http/https 完整链接", () => {
    for (const v of [
      "https://example.com",
      "http://example.com/a/b?c=1#d",
      "https://xn--fiqs8s.example/中文",
      "http://127.0.0.1:8080/x",
      "https://example.com/%20space",
    ]) {
      expect(okUrl(v), v).toBe(true)
    }
  })

  it("拒绝危险 scheme / 裸主机 / 账号密码 / 控制字符 / 空白", () => {
    const bad = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "example.com",
      "/relative/path",
      "https://user:pass@host.example/",
      "https://host.example/a b",
      "https://host.example/a<b",
      "https://host.example/a\tb",
      "https://host.example/a\nb",
      "about:blank",
      "mailto:a@b.example",
      "",
    ]
    for (const v of bad) expect(okUrl(v), v).toBe(false)
  })

  it("2048 长度上限（列宽）；前后空白自动 trim", () => {
    expect(okUrl(`https://a.example/${"x".repeat(2030)}`)).toBe(true)
    expect(okUrl(`https://a.example/${"x".repeat(2040)}`)).toBe(false)
    expect(httpUrlSchema.parse("  https://a.example  ")).toBe("https://a.example")
  })

  it("checkHttpUrl 对 javascript 变体（协议大小写/前导空白）一律拒绝", () => {
    for (const v of [" javascript:alert(1)", "JaVaScRiPt:alert(1)", "https://[bad", "http://host:99999/"]) {
      expect(checkHttpUrl(v) !== null || !httpUrlSchema.safeParse(v).success, v).toBe(true)
    }
  })
})

describe("P6B Logo/预览图路径（mediaPathSchema）", () => {
  const schema = mediaPathSchema("Logo", 1024)
  it("接受空串 / 站内 /uploads 路径 / http(s) 绝对链接（历史快照行）", () => {
    for (const v of ["", "/uploads/2026/11/07/a.webp", "https://cdn.example/logo.png", "http://cdn.example/logo.png"]) {
      expect(schema.safeParse(v).success, v).toBe(true)
    }
  })
  it("拒绝协议相对 //、裸相对路径、反斜杠、危险 scheme（问题 03 收紧后：裸 / 与站内未知后缀同样拒绝）", () => {
    for (const v of ["//cdn.example/x", "uploads/x.png", "\\uploads\\x", "javascript:x", "data:image/png;base64,x", "ftp://x/y", "/", "/uploads/x.php"]) {
      expect(schema.safeParse(v).success, v).toBe(false)
    }
  })
})

describe("P6B 新建/编辑 schema", () => {
  const base = { title: "示例", url: "https://a.example", categoryId: "123456789012345678" }

  it("create：必填 title/url/categoryId；status/isGone 客户端字段被剥离（恒 draft）", () => {
    const parsed = createLinkSchema.safeParse({ ...base, status: "published", isGone: true })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect("status" in parsed.data).toBe(false)
      expect("isGone" in parsed.data).toBe(false)
    }
    expect(createLinkSchema.safeParse({ ...base, title: " " }).success).toBe(false)
    expect(createLinkSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false)
    expect(createLinkSchema.safeParse({ ...base, categoryId: "abc" }).success).toBe(false)
    expect(createLinkSchema.safeParse({ ...base, categoryId: "1234567890123456789012" }).success).toBe(false)
  })

  it("update：无 version 拒绝；空 patch 拒绝；detail:null / tagId:null 合法", () => {
    expect(updateLinkSchema.safeParse({ title: "x" }).success).toBe(false)
    const empty = updateLinkSchema.safeParse({ version: 1 })
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0]?.message).toBe("没有需要修改的字段")
    expect(updateLinkSchema.safeParse({ version: 1, detail: null }).success).toBe(true)
    expect(updateLinkSchema.safeParse({ version: 1, tagId: null }).success).toBe(true)
    expect(updateLinkSchema.safeParse({ version: 1, mirrors: [] }).success).toBe(true)
  })

  it("update：status 字段不在 schema（提交被剥离，普通编辑改不了状态）", () => {
    const parsed = updateLinkSchema.safeParse({ title: "x", status: "published", version: 1 })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect("status" in parsed.data).toBe(false)
  })

  it("mirrors：全量替换数组；同 id 重复拒绝；最多 20 条", () => {
    const dup = updateLinkSchema.safeParse({
      version: 1,
      mirrors: [
        { id: "101", name: "a", url: "https://m.example" },
        { id: "101", name: "b", url: "https://m2.example" },
      ],
    })
    expect(dup.success).toBe(false)
    const many = updateLinkSchema.safeParse({
      version: 1,
      mirrors: Array.from({ length: 21 }, (_, i) => ({ name: `m${i}`, url: `https://m${i}.example` })),
    })
    expect(many.success).toBe(false)
  })

  it("detail：detailHtml 20000 上限（64KB 请求体之下）；计数非负整数", () => {
    expect(updateLinkSchema.safeParse({ version: 1, detail: { detailHtml: "<p>x</p>" } }).success).toBe(true)
    expect(updateLinkSchema.safeParse({ version: 1, detail: { detailHtml: "x".repeat(20_001) } }).success).toBe(false)
    expect(updateLinkSchema.safeParse({ version: 1, detail: { clickCount: -1 } }).success).toBe(false)
    expect(updateLinkSchema.safeParse({ version: 1, detail: { clickCount: 1.5 } }).success).toBe(false)
  })

  it("status 切换 body：status+version 必填", () => {
    expect(linkStatusChangeSchema.safeParse({ status: "published", version: 2 }).success).toBe(true)
    expect(linkStatusChangeSchema.safeParse({ status: "active", version: 2 }).success).toBe(false)
    expect(linkStatusChangeSchema.safeParse({ status: "published" }).success).toBe(false)
  })
})

describe("P6B 列表查询 schema", () => {
  it("默认 page=1 / pageSize=20 / sortBy=updatedAt / includeDeleted=false（字符串强转）", () => {
    const q = linkListQuerySchema.parse({})
    expect(q.page).toBe(1)
    expect(q.pageSize).toBe(20)
    expect(q.sortBy).toBe("updatedAt")
    expect(q.sortDir).toBe("asc")
    expect(q.includeDeleted).toBe(false)
    expect(linkListQuerySchema.parse({ includeDeleted: "true" }).includeDeleted).toBe(true)
  })
  it("pageSize 白名单 20/50/100；sortBy 白名单", () => {
    expect(linkListQuerySchema.safeParse({ pageSize: "30" }).success).toBe(false)
    expect(linkListQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true)
    expect(linkListQuerySchema.safeParse({ sortBy: "clickCount" }).success).toBe(false)
    expect(linkListQuerySchema.safeParse({ sortBy: "title", sortDir: "desc" }).success).toBe(true)
  })
  it("categoryId/tagId 必须是 BIGINT 十进制串", () => {
    expect(linkListQuerySchema.safeParse({ categoryId: "123456789012345678" }).success).toBe(true)
    expect(linkListQuerySchema.safeParse({ categoryId: "0" }).success).toBe(false)
    expect(linkListQuerySchema.safeParse({ tagId: "1e5" }).success).toBe(false)
  })
})

describe("P6B 服务端 HTML 净化（sanitizeDetailHtml）", () => {
  it("script/style/iframe 连同内容整体删除", () => {
    expect(sanitizeDetailHtml("<p>a</p><script>alert(1)</script>")).toBe("<p>a</p>")
    expect(sanitizeDetailHtml("<style>body{}</style><b>x</b>")).toBe("<b>x</b>")
    expect(sanitizeDetailHtml('<iframe src="https://evil.example"><p>fb</p></iframe>ok')).toBe("ok")
    expect(sanitizeDetailHtml("<SCRIPT>alert(2)</SCRIPT>")).toBe("")
  })

  it("on* 事件属性与 style 一律丢弃（大小写不敏感）", () => {
    expect(sanitizeDetailHtml('<img src="/uploads/a.png" onerror="alert(1)" ONLOAD=x style="x">')).toBe(
      '<img src="/uploads/a.png">',
    )
    expect(sanitizeDetailHtml('<div onclick="alert(1)" class="c">t</div>')).toBe('<div class="c">t</div>')
  })

  it("href/src 协议：javascript:/data:/vbscript: 被剥离；http(s)/站内/#/mailto 保留", () => {
    expect(sanitizeDetailHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>")
    expect(sanitizeDetailHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>")
    expect(sanitizeDetailHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe("<a>x</a>") // 实体混淆
    expect(sanitizeDetailHtml('<a href="java&#x09;script:alert(1)">x</a>')).toBe("<a>x</a>") // 实体 tab 拆分
    expect(sanitizeDetailHtml('<a href="java\tscript:alert(1)">x</a>')).toBe("<a>x</a>") // 裸 tab 拆分
    expect(sanitizeDetailHtml('<a href="java script:alert(1)">x</a>')).toBe("<a>x</a>") // NUL 注入
    expect(sanitizeDetailHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).toBe("<img>")
    expect(sanitizeDetailHtml('<a href="https://ok.example/p?a=1">x</a>')).toBe('<a href="https://ok.example/p?a=1">x</a>')
    expect(sanitizeDetailHtml('<a href="/rel/path">x</a>')).toBe('<a href="/rel/path">x</a>')
    expect(sanitizeDetailHtml('<a href="#frag">x</a>')).toBe('<a href="#frag">x</a>')
    expect(sanitizeDetailHtml('<a href="mailto:a@b.example">x</a>')).toBe('<a href="mailto:a@b.example">x</a>')
    expect(sanitizeDetailHtml('<a href="//cdn.example/x">x</a>')).toBe('<a href="//cdn.example/x">x</a>') // 协议相对按 https 解析
  })

  it("a[target] 强制 rel=noopener（防 reverse-tabnabbing）", () => {
    expect(sanitizeDetailHtml('<a href="https://a.example" target="_blank">x</a>')).toBe(
      '<a href="https://a.example" target="_blank" rel="noopener noreferrer">x</a>',
    )
    expect(sanitizeDetailHtml('<a target="_blank" rel="help" href="https://a.example">x</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer" href="https://a.example">x</a>',
    )
  })

  it("注释/CDATA/PI 删除；孤立 < 按文本转义；未闭合标签尾部丢弃", () => {
    expect(sanitizeDetailHtml("a<!-- s3cr3t -->b")).toBe("ab")
    expect(sanitizeDetailHtml("<![CDATA[raw]]><b>x</b>")).toBe("<b>x</b>")
    expect(sanitizeDetailHtml("<?php echo 1 ?><p>t</p>")).toBe("<p>t</p>")
    expect(sanitizeDetailHtml("a < b")).toBe("a &lt; b")
    expect(sanitizeDetailHtml("<p>ok<p>broken")).toContain("<p>ok")
  })

  it("未知标签剥壳保文本；排版白名单标签保留", () => {
    expect(sanitizeDetailHtml("<marquee>run</marquee>")).toBe("run")
    expect(sanitizeDetailHtml("<blink>x</blink>")).toBe("x")
    expect(sanitizeDetailHtml("<strong>粗</strong><em>斜</em>")).toBe("<strong>粗</strong><em>斜</em>")
    expect(sanitizeDetailHtml('<table><tr><td colspan="2">c</td></tr></table>')).toBe(
      '<table><tr><td colspan="2">c</td></tr></table>',
    )
    expect(sanitizeDetailHtml("<br/>")).toBe("<br>")
    expect(sanitizeDetailHtml("<hr>")).toBe("<hr>")
  })

  it("控制字符注入被清除（拆分协议名不能伪装；NUL 不残留）", () => {
    expect(sanitizeDetailHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>")
    expect(sanitizeDetailHtml("<p>ab</p>")).toBe("<p>ab</p>")
    expect(sanitizeDetailHtml("<p>a b</p>")).toBe("<p>a b</p>") // 普通空格是合法文本，不误删
  })

  it("文本实体保留既有写法、转义裸 < > 与未构成实体的 &", () => {
    expect(sanitizeDetailHtml("A &amp; B &nbsp; C")).toBe("A &amp; B &nbsp; C")
    expect(sanitizeDetailHtml("price 5 & 6")).toBe("price 5 &amp; 6")
  })

  it("净化幂等（对输出再净化不产生新变化）", () => {
    for (const src of [
      '<p onclick="x">a<script>b</script><a href="javascript:x">l</a></p>',
      '<div style="c"><span>t</span></div><iframe src="https://e"></iframe>',
      "plain text with < b",
      '<img src="/a.png" onerror=alert(1)>',
    ]) {
      const once = sanitizeDetailHtml(src)
      expect(sanitizeDetailHtml(once), src).toBe(once)
    }
  })

  it("isSafeContentUrl 单元边界", () => {
    expect(isSafeContentUrl("https://a.example")).toBe(true)
    expect(isSafeContentUrl("/uploads/x")).toBe(true)
    expect(isSafeContentUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeContentUrl(" ")).toBe(false)
    expect(isSafeContentUrl("")).toBe(false)
  })
})
