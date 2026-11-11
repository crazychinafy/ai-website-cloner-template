// P5 测试：导航权限矩阵（buildNav；权限集直接取 P2 Seed 字典语义）
// 四个标准角色的权限集与 Seed 一致（super_admin=42 / content_admin=32 /
// content_editor=22 / auditor=12）；此处用真实字典派生（import seed 常量不可行 →
// 在 p5-permissions.test.ts 用真实 DB 核对，本文件验证"过滤逻辑"本身）。
import { describe, expect, it } from "vitest"
import { ADMIN_NAV, buildNav, isNavGroup } from "../../src/lib/admin/ui/navigation"

/** 用 Seed 标准角色权限集（与 scripts/admin/seed-rbac.ts 语义一致） */
const CONTENT_RESOURCES = ["categories", "links", "articles", "bulletins", "ads", "tags", "lines"]
const ALL_PERMS = [
  "dashboard.read",
  ...CONTENT_RESOURCES.flatMap((r) => [
    `${r}.read`,
    `${r}.create`,
    `${r}.update`,
    `${r}.delete`,
  ]),
  "links.publish",
  "articles.publish",
  "bulletins.publish",
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

const permsFor = (role: "super_admin" | "content_admin" | "content_editor" | "auditor"): string[] => {
  switch (role) {
    case "super_admin":
      return ALL_PERMS
    case "content_admin":
      return ["dashboard.read", ...CONTENT_RESOURCES.flatMap((r) => [`${r}.read`, `${r}.create`, `${r}.update`, `${r}.delete`]), "links.publish", "articles.publish", "bulletins.publish"]
    case "content_editor":
      return ["dashboard.read", ...CONTENT_RESOURCES.flatMap((r) => [`${r}.read`, `${r}.create`, `${r}.update`])]
    case "auditor":
      return [
        ...["dashboard", "categories", "links", "articles", "bulletins", "ads", "tags", "lines", "settings", "administrators", "audit_logs"].map((r) => `${r}.read`),
        "imports.preview",
      ]
  }
}

const labels = (nav: ReturnType<typeof buildNav>) =>
  nav.flatMap((n) => (isNavGroup(n) ? [n.label, ...n.items.map((i) => i.label)] : [n.label]))

describe("buildNav 权限菜单（§5.1）", () => {
  it("1. super_admin 看到全部 4 个顶层节点（工作台 + 3 组，共 14 个条目）", () => {
    const nav = buildNav(permsFor("super_admin"))
    expect(nav.map((n) => n.label)).toEqual(["工作台", "内容管理", "运营管理", "系统管理"])
    const all = labels(nav)
    expect(all).toContain("网址管理")
    expect(all).toContain("管理员管理")
    expect(all).toContain("数据导入")
    expect(all).toContain("工作台")
    // 14 个条目（内容组 6 / 运营组 3 / 系统组 4 + 工作台 1）+ 3 个分组标签 = 17（labels() 含分组标签）
    expect(all).toHaveLength(17)
  })

  it("2. content_admin 无系统组（administrators/audit/imports 无权限）", () => {
    const nav = buildNav(permsFor("content_admin"))
    expect(nav.map((n) => n.label)).toEqual(["工作台", "内容管理", "运营管理"])
    const all = labels(nav)
    expect(all).not.toContain("管理员管理")
    expect(all).not.toContain("操作日志")
    expect(all).not.toContain("数据导入")
    expect(all).toContain("网址管理")
  })

  it("3. content_editor 同 content_admin 可见模块（菜单按读权限显示；写操作仍由服务端守卫）", () => {
    const nav = buildNav(permsFor("content_editor"))
    expect(nav.map((n) => n.label)).toEqual(["工作台", "内容管理", "运营管理"])
  })

  it("4. auditor 全部只读模块可见（含系统组只读项），无待开放链接差异", () => {
    const nav = buildNav(permsFor("auditor"))
    const all = labels(nav)
    expect(all).toContain("管理员管理") // administrators.read
    expect(all).toContain("操作日志") // audit_logs.read
    expect(all).toContain("数据导入") // imports.preview
    expect(all).toContain("站点设置") // settings.read
  })

  it("5. 无权限（空集合）→ 空导航（无任何菜单项）", () => {
    expect(buildNav([])).toEqual([])
  })

  it("6. 父级分组仅在存在可见子菜单时显示（§5.1.5）", () => {
    // 只有 ads.read → 运营组显示且仅含"广告管理"
    const nav = buildNav(["ads.read"])
    expect(nav).toHaveLength(1)
    const group = nav[0]
    expect(group.label).toBe("运营管理")
    if (isNavGroup(group)) {
      expect(group.items.map((i) => i.label)).toEqual(["广告管理"])
    } else {
      throw new Error("expected group")
    }
  })

  it("7. 未开发模块保持 pending 标记且无 href（不产生死链，§5）", () => {
    const nav = buildNav(permsFor("super_admin"))
    const links = nav.flatMap((n) => (isNavGroup(n) ? n.items : [n]))
    const pending = links.filter((l) => !("items" in l))
    for (const item of pending) {
      if ("href" in item && item.href === "/admin") continue // 工作台已实现
      if (!("pending" in item)) continue
      if (item.pending) {
        expect(item.href, `${item.label} 不得有链接`).toBeUndefined()
      }
    }
    const workbench = pending.find((i) => i.label === "工作台")
    if (workbench && "href" in workbench) {
      expect(workbench.href).toBe("/admin")
      expect("pending" in workbench).toBe(false)
    }
  })

  it("8. 导航树结构完整（4 顶层 = 1 独立 + 3 分组）", () => {
    expect(ADMIN_NAV).toHaveLength(4)
    expect(ADMIN_NAV.filter((n) => isNavGroup(n))).toHaveLength(3)
  })
})
