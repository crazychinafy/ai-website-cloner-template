// P6C §14：统一服务端 HTML 净化（security/html-sanitizer）单元测试
// - XSS payload ≥8 个（onclick / script / javascript:（大小写/实体拆分）/ img+onerror /
//   iframe / svg / form / style expression / data: / 协议相对 href）
// - 幂等：每个 payload 与全部历史正文再净化结果不变（「只在真实保存时清洗」的前提）
// - style 声明级白名单（color/background-color/font-size，hex/rgb/rgba/px|em|rem）
// - href/src 策略函数 + target=_blank rel 强制 + class/id/data-* 丢弃 + htmlDigest
import { describe, expect, it } from "vitest"
import { ALL_ARTICLES } from "../../src/lib/facai8/data/articles"
import {
  htmlDigest,
  isSafeMediaSrc,
  isSafeSiteHref,
  sanitizeRichHtml,
} from "../../src/lib/admin/security/html-sanitizer.ts"

// ── XSS payload 精确合同（净化输出逐字节断言）────────────────────

describe("sanitizeRichHtml：XSS payload（验收要求 ≥8 个）", () => {
  const XSS: Array<[label: string, input: string, output: string]> = [
    ["1 事件属性 onclick", '<p onclick="alert(1)">保留</p>', "<p>保留</p>"],
    ["2 script 连同内容丢弃", "<script>alert(1)</script><p>ok</p>", "<p>ok</p>"],
    ["3 javascript: href", '<a href="javascript:alert(1)">链</a>', "<a>链</a>"],
    ["4 javascript: 大小写混淆", '<a href="JaVaScRiPt:alert(1)">链</a>', "<a>链</a>"],
    ["5 javascript: 实体拆词（java&#10;script:）", '<a href="java&#10;script:alert(1)">链</a>', "<a>链</a>"],
    ["6 img onerror（src 无效整标签丢弃）", '<img src="x" onerror="alert(1)" />', ""],
    ["7 iframe 整体丢弃", '<iframe src="https://evil.example"></iframe>', ""],
    ["8 svg onload 整体丢弃", "<svg onload=alert(1)><circle /></svg>", ""],
    ["9 form/input 丢弃", '<form onsubmit="return false"><input /></form>', ""],
    ["10 style expression()", '<div style="width: expression(alert(1))">x</div>', "<div>x</div>"],
    ["11 style 内嵌 javascript: url()", '<p style="background: url(javascript:alert(1))">x</p>', "<p>x</p>"],
    ["12 data: href", '<a href="data:text/html,<script>alert(1)</script>">x</a>', "<a>x</a>"],
    ["13 协议相对 // href", '<a href="//evil.example">x</a>', "<a>x</a>"],
    ["14 img data: src 丢弃", '<img src="data:image/png;base64,AAA" />', ""],
    ["15 style 标签内容丢弃", "<style>body{background:url(javascript:alert(1))}</style><p>keep</p>", "<p>keep</p>"],
  ]

  for (const [label, input, output] of XSS) {
    it(label, () => {
      expect(sanitizeRichHtml(input)).toBe(output)
    })
  }

  it("payload 全部幂等（对输出再净化不变）", () => {
    for (const [, input] of XSS) {
      const once = sanitizeRichHtml(input)
      expect(sanitizeRichHtml(once), input).toBe(once)
    }
  })

  it("payload 产物中不残留 script/事件属性/危险协议", () => {
    for (const [, input] of XSS) {
      const out = sanitizeRichHtml(input)
      expect(out, input).not.toMatch(/<script|<iframe|<svg|<form|<input/i)
      expect(out, input).not.toMatch(/\son[a-z]+\s*=/i)
      expect(out, input).not.toMatch(/javascript:/i)
    }
  })

  it("转义文本不被二次解释（&lt;script&gt; 保持实体）", () => {
    expect(sanitizeRichHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    )
  })
})

// ── 白名单排版标签与属性（编辑器产物 / 历史正文形态）──────────────

describe("sanitizeRichHtml：allowlist 排版标签与属性", () => {
  it("常用排版标签原样往返", () => {
    const html =
      '<h3>标题</h3><p>段落</p><p><strong>粗</strong><em>斜</em></p>' +
      '<blockquote>引用</blockquote><ul><li>a</li></ul><ol start="2"><li value="3">b</li></ol>' +
      '<a href="https://a.example" title="t">外</a><hr /><br />'
    expect(sanitizeRichHtml(html)).toBe(html)
  })

  it("table/figure 结构保留", () => {
    const html =
      '<table><caption>表</caption><thead><tr><th colspan="2">头</th></tr></thead>' +
      "<tbody><tr><td rowspan=\"2\">格</td></tr></tbody></table>"
    expect(sanitizeRichHtml(html)).toBe(html)
    const fig = '<figure><img src="/uploads/a.png" alt="z" /><figcaption>说明</figcaption></figure>'
    expect(sanitizeRichHtml(fig)).toBe(fig)
  })

  it("未知标签剥壳留文本（marquee/font）", () => {
    expect(sanitizeRichHtml("<marquee>m</marquee>")).toBe("m")
    expect(sanitizeRichHtml("<p>a<b>bold</b><font color=red>f</font></p>")).toBe("<p>a<b>bold</b>f</p>")
  })

  it("class/id/data-* 一律丢弃", () => {
    expect(sanitizeRichHtml('<p class="a" id="b" data-x="y">t</p>')).toBe("<p>t</p>")
  })

  it("a[target=_blank] 强制 rel；其他 target 丢弃", () => {
    expect(sanitizeRichHtml('<a href="https://x.example" target="_blank">t</a>')).toBe(
      '<a href="https://x.example" target="_blank" rel="noopener noreferrer">t</a>',
    )
    expect(sanitizeRichHtml('<a href="https://x.example" target="_top">t</a>')).toBe(
      '<a href="https://x.example">t</a>',
    )
  })

  it("img：站内素材 src 保留；width/height 只留纯数字", () => {
    expect(sanitizeRichHtml('<img src="/uploads/a.png" alt="a" />')).toBe('<img src="/uploads/a.png" alt="a" />')
    expect(sanitizeRichHtml('<img src="/uploads/a.png" width="wide" height="300" />')).toBe(
      '<img src="/uploads/a.png" height="300" />',
    )
  })

  it("href：站内根路径 / #片段 / http(s) 保留；.. 穿越与 mailto 丢弃", () => {
    expect(sanitizeRichHtml('<a href="/articles/123">内</a>')).toBe('<a href="/articles/123">内</a>')
    expect(sanitizeRichHtml('<a href="#top">锚</a>')).toBe('<a href="#top">锚</a>')
    expect(sanitizeRichHtml('<a href="/uploads/../etc/passwd">t</a>')).toBe("<a>t</a>")
    expect(sanitizeRichHtml('<a href="mailto:a@b.c">m</a>')).toBe("<a>m</a>")
  })

  it("空输入与纯空白返回空串；纯文本原样", () => {
    expect(sanitizeRichHtml("")).toBe("")
    expect(sanitizeRichHtml("   \n\t ")).toBe("")
    expect(sanitizeRichHtml("hello")).toBe("hello")
  })

  it("嵌套深度上限 32（超限剥壳留文本）", () => {
    const deep = "<div>".repeat(40) + "x" + "</div>".repeat(40)
    const out = sanitizeRichHtml(deep)
    expect(out.split("<div>").length - 1).toBeLessThanOrEqual(32)
    expect(out).toContain("x")
  })
})

// ── style 声明级白名单 ───────────────────────────────────────────

describe("sanitizeRichHtml：style 白名单（color/background-color/font-size）", () => {
  it("安全声明保留（空白规范化、大小写保留）", () => {
    expect(
      sanitizeRichHtml('<span style="color:#FFF; background-color: rgb(255, 255, 255); font-size: 16px">x</span>'),
    ).toBe('<span style="color:#FFF;background-color:rgb(255, 255, 255);font-size:16px">x</span>')
    expect(sanitizeRichHtml('<p style="color:#fff;background-color:rgb(0,0,0);font-size:12px">s</p>')).toBe(
      '<p style="color:#fff;background-color:rgb(0,0,0);font-size:12px">s</p>',
    )
    expect(sanitizeRichHtml('<span style="color:rgba(1,2,3,0.5)">x</span>')).toBe(
      '<span style="color:rgba(1,2,3,0.5)">x</span>',
    )
  })

  it("非白名单声明/值一律剥离（red 关键字、pt 单位、background 简写、url()）", () => {
    expect(sanitizeRichHtml('<p style="color: red">x</p>')).toBe("<p>x</p>")
    expect(sanitizeRichHtml("<p style=\"font-size: 17pt\">x</p>")).toBe("<p>x</p>")
    expect(sanitizeRichHtml('<p style="background: url(/a.png)">x</p>')).toBe("<p>x</p>")
    expect(sanitizeRichHtml('<p style="position:absolute;z-index:9999">x</p>')).toBe("<p>x</p>")
  })

  it("事件属性与 style 共存：style 留、on* 删", () => {
    expect(sanitizeRichHtml('<p onclick="alert(1)" style="color:#ababab">保留</p>')).toBe(
      '<p style="color:#ababab">保留</p>',
    )
  })
})

// ── 历史正文回归：真实存量数据只清洗不损坏 ───────────────────────

describe("sanitizeRichHtml：历史正文（28 篇静态数据）回归", () => {
  it("ALL_ARTICLES 每篇 content 净化后幂等", () => {
    expect(ALL_ARTICLES.length).toBeGreaterThanOrEqual(28)
    for (const a of ALL_ARTICLES) {
      const once = sanitizeRichHtml(a.content)
      expect(sanitizeRichHtml(once), `article ${a.id}`).toBe(once)
    }
  })

  it("净化后不残留脚本/事件属性/危险协议，且排版标签与标题文本仍在", () => {
    for (const a of ALL_ARTICLES) {
      const out = sanitizeRichHtml(a.content)
      expect(out, `article ${a.id}`).not.toMatch(/<script|<iframe|<svg|<form/i)
      expect(out, `article ${a.id}`).not.toMatch(/\son[a-z]+\s*=/i)
      expect(out, `article ${a.id}`).not.toMatch(/javascript:/i)
      // 正文非空的存量文章净化后不应变成空（allowlist 覆盖其标签集）
      if (a.content.trim() !== "") expect(out, `article ${a.id}`).not.toBe("")
    }
  })

  it("常见历史标签（p/br/strong/blockquote/hr/img/a）净化后保留", () => {
    const probes: Array<[string, RegExp]> = [
      ["<p>", /<p>/],
      ["<br", /<br\s*\/?>/i],
      ["<strong>", /<strong>/],
      ["<blockquote>", /<blockquote>/],
      ["<hr", /<hr\s*\/?>/i],
      ["<a href", /<a href="[^"]+"/],
      ["<img src", /<img src="[^"]+"/],
    ]
    const joined = ALL_ARTICLES.map((a) => sanitizeRichHtml(a.content)).join("\n")
    for (const [label, re] of probes) {
      expect(re.test(joined), `历史正文应含 ${label}`).toBe(true)
    }
  })
})

// ── 策略函数与摘要 ───────────────────────────────────────────────

describe("isSafeMediaSrc", () => {
  it("站内素材前缀与 http(s) 绝对地址放行", () => {
    for (const v of [
      "/uploads/a.png",
      "/sites/x/y.png",
      "/images/a.png",
      "/videos/a.mp4",
      "/media/a.png",
      "https://cdn.example/a.png",
      "http://cdn.example/a.png",
    ]) {
      expect(isSafeMediaSrc(v), v).toBe(true)
    }
  })

  it("协议相对 / data: / 反斜杠 / .. 穿越 / 非素材前缀 / 其他协议拒绝", () => {
    for (const v of [
      "//cdn.example/a.png",
      "data:image/png;base64,AAA",
      "\\uploads\\a.png",
      "/uploads/../etc/passwd",
      "/other/a.png",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "",
      "   ",
    ]) {
      expect(isSafeMediaSrc(v), v).toBe(false)
    }
  })

  it("控制字符拆词防护（squeeze 重组后判定）", () => {
    expect(isSafeMediaSrc("/upl\u0000oads/a.png")).toBe(true) // NUL 删除后仍是合法前缀
    expect(isSafeSiteHref("java\u0000script:alert(1)")).toBe(false) // 重组后 javascript: 被拒
    expect(isSafeSiteHref("/upl\u0000oads/../x")).toBe(false)
  })
})

describe("isSafeSiteHref", () => {
  it("站内根路径 / #片段 / http(s) 放行", () => {
    for (const v of ["/articles/123", "/bulletin/1", "#top", "https://a.example", "http://a.example/x"]) {
      expect(isSafeSiteHref(v), v).toBe(true)
    }
  })

  it("协议相对 / mailto / javascript / .. / 反斜杠拒绝", () => {
    for (const v of ["//a.example", "mailto:a@b.c", "javascript:alert(1)", "/a/../b", "/a\\b", "data:text/html,x", ""]) {
      expect(isSafeSiteHref(v), v).toBe(false)
    }
  })
})

describe("htmlDigest", () => {
  it("长度 + SHA-256（审计只存摘要不存全文）", () => {
    const d = htmlDigest("abc")
    expect(d.length).toBe(3)
    expect(d.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(htmlDigest("").length).toBe(0)
  })

  it("同文同摘要、异文异摘要（正文是否变更可判定）", () => {
    expect(htmlDigest("<p>a</p>").sha256).toBe(htmlDigest("<p>a</p>").sha256)
    expect(htmlDigest("<p>a</p>").sha256).not.toBe(htmlDigest("<p>b</p>").sha256)
  })
})
