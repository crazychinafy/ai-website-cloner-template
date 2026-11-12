// P7 测试：导航解锁（操作日志 / 数据导入 从 pending → 真实路由）
// - 两个条目必须带 href、无 pending 标记（死链防护）
// - ADMIN_PAGE_ROUTES 收录两个新路由（面包屑 / 侧栏高亮）
// - 菜单可见性仍按权限过滤：auditor 可见两项，content_admin 两项皆不可见
import { describe, expect, it } from "vitest"
import { ADMIN_PAGE_ROUTES, buildNav, isNavGroup } from "../../src/lib/admin/ui/navigation"

const flatItems = (perms: string[]) =>
  buildNav(perms).flatMap((n) => (isNavGroup(n) ? n.items : [n]))

describe("P7 导航解锁：操作日志 + 数据导入", () => {
  it("两个条目已挂真实 href 且不再有 pending 标记", () => {
    const items = flatItems(["audit_logs.read", "imports.preview"])
    const audit = items.find((i) => i.label === "操作日志")
    const imports = items.find((i) => i.label === "数据导入")
    expect(audit).toBeDefined()
    expect(imports).toBeDefined()
    expect(audit && "href" in audit && audit.href).toBe("/admin/audit-logs")
    expect(imports && "href" in imports && imports.href).toBe("/admin/imports")
    expect(audit && "pending" in audit).toBe(false)
    expect(imports && "pending" in imports).toBe(false)
  })

  it("ADMIN_PAGE_ROUTES 收录两个新路由", () => {
    expect(ADMIN_PAGE_ROUTES.has("/admin/audit-logs")).toBe(true)
    expect(ADMIN_PAGE_ROUTES.has("/admin/imports")).toBe(true)
  })

  it("权限过滤不变：仅有 audit_logs.read 只见操作日志；无权限则整组隐藏", () => {
    const auditOnly = flatItems(["audit_logs.read"])
    expect(auditOnly.map((i) => i.label)).toEqual(["操作日志"])
    // imports.preview 单独 → 只见数据导入
    const importOnly = flatItems(["imports.preview"])
    expect(importOnly.map((i) => i.label)).toEqual(["数据导入"])
    // content_admin 语义（无任何系统组权限）→ 系统组完全不出现
    const nav = buildNav(["dashboard.read", "links.read", "articles.read"])
    expect(nav.map((n) => n.label)).not.toContain("系统管理")
  })
})
