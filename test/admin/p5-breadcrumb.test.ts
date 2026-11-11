// P5 测试：面包屑（§8：中文映射 / 当前页最后一级 / 不重复工作台 / 不暴露原始路径）
import { describe, expect, it } from "vitest"
import { buildBreadcrumb } from "../../src/lib/admin/ui/breadcrumb"
import { buildNav } from "../../src/lib/admin/ui/navigation"

const SUPER = [
  "dashboard.read",
  "categories.read",
  "categories.create",
  "categories.update",
  "categories.delete",
  "links.read",
  "links.create",
  "links.update",
  "links.publish",
  "links.delete",
  "articles.read",
  "articles.create",
  "articles.update",
  "articles.publish",
  "articles.delete",
  "bulletins.read",
  "bulletins.create",
  "bulletins.update",
  "bulletins.publish",
  "bulletins.delete",
  "ads.read",
  "ads.create",
  "ads.update",
  "ads.delete",
  "tags.read",
  "tags.create",
  "tags.update",
  "tags.delete",
  "lines.read",
  "lines.create",
  "lines.update",
  "lines.delete",
  "settings.read",
  "settings.update",
  "administrators.read",
  "administrators.create",
  "administrators.update",
  "administrators.disable",
  "administrators.assign_role",
  "audit_logs.read",
  "imports.preview",
  "imports.execute",
]

const nav = buildNav(SUPER)
const crumbs = (path: string) => buildBreadcrumb(path, nav).map((c) => c.label)
const hrefs = (path: string) => buildBreadcrumb(path, nav).map((c) => c.href)

describe("面包屑构建", () => {
  it("1. 根页面 /admin → 单级「工作台」（当前页，无链接）", () => {
    expect(crumbs("/admin")).toEqual(["工作台"])
    expect(hrefs("/admin")).toEqual([undefined])
  })

  it("2. 尾斜杠归一化：/admin/ 与 /admin 等价", () => {
    expect(crumbs("/admin/")).toEqual(["工作台"])
  })

  it("3. 403 页面 → 工作台 / 权限不足（末级不可点击）", () => {
    expect(crumbs("/admin/forbidden")).toEqual(["工作台", "权限不足"])
    const h = hrefs("/admin/forbidden")
    expect(h[0]).toBe("/admin")
    expect(h[1]).toBeUndefined()
  })

  it("4. 未注册路径不暴露原始 URL 片段（回退单一工作台，可安全返回）", () => {
    expect(crumbs("/admin/nonexistent-page")).toEqual(["工作台"])
    expect(hrefs("/admin/nonexistent-page")).toEqual(["/admin"])
  })

  it("5. 非后台路径（防御）→ 仅工作台链接", () => {
    expect(crumbs("/")).toEqual(["工作台"])
    expect(hrefs("/")).toEqual(["/admin"])
  })

  it("6. P6B 已实现 /admin/links → 工作台 / 内容管理 / 网址管理（分组与当前页不可点击）", () => {
    // P6B 起该模块已开放：导航条目带 href，面包屑生成完整层级
    expect(crumbs("/admin/links")).toEqual(["工作台", "内容管理", "网址管理"])
    const h = hrefs("/admin/links")
    expect(h[0]).toBe("/admin")
    expect(h[1]).toBeUndefined() // 分组名只展示，不可点击（P5 规则 3）
    expect(h[2]).toBeUndefined() // 当前页不可点击
  })

  it("6b. P6C 已实现 /admin/articles 与 /admin/bulletins → 完整层级（当前页不可点击）", () => {
    expect(crumbs("/admin/articles")).toEqual(["工作台", "内容管理", "文章管理"])
    const h = hrefs("/admin/articles")
    expect(h[0]).toBe("/admin")
    expect(h[1]).toBeUndefined() // 分组名只展示，不可点击（P5 规则 3）
    expect(h[2]).toBeUndefined() // 当前页不可点击
    expect(crumbs("/admin/bulletins")).toEqual(["工作台", "内容管理", "公告管理"])
  })

  it("6c. P6C 编辑器子页（/new、/[id]）→ 上级模块页可点击，当前页静态标题（不暴露原始 ID）", () => {
    expect(crumbs("/admin/articles/new")).toEqual(["工作台", "内容管理", "文章管理", "新建文章"])
    const h = hrefs("/admin/articles/new")
    expect(h[2]).toBe("/admin/articles") // 上级可点击
    expect(h[3]).toBeUndefined() // 当前页不可点击
    expect(crumbs("/admin/articles/112546110991634432")).toEqual(["工作台", "内容管理", "文章管理", "编辑文章"])
    expect(crumbs("/admin/bulletins/new")).toEqual(["工作台", "内容管理", "公告管理", "新建公告"])
    expect(crumbs("/admin/bulletins/42")).toEqual(["工作台", "内容管理", "公告管理", "编辑公告"])
  })

  it("6d. 无模块权限时编辑器子页仍回退单一工作台（不产生死链）", () => {
    const noArticles = buildNav(["dashboard.read", "links.read"])
    expect(buildBreadcrumb("/admin/articles/new", noArticles)).toEqual([{ label: "工作台", href: "/admin" }])
  })

  it("7. 无权限（空导航）时根页面仍为单级工作台", () => {
    expect(buildBreadcrumb("/admin", buildNav([]))).toEqual([{ label: "工作台" }])
  })

  it("8. 「工作台」不重复出现（任意路径）", () => {
    for (const p of ["/admin", "/admin/forbidden", "/admin/links", "/admin/x/y/z"]) {
      const list = crumbs(p)
      expect(list.filter((l) => l === "工作台"), p).toHaveLength(1)
    }
  })
})
