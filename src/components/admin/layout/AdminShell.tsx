"use client"

// P5：AdminShell 后台独立布局（禁止复用前台 SiteFrame/Header/导航）
// ─────────────────────────────────────────────────────────────────
// 桌面（≥1024px）：固定 240px 侧边导航（可收起为 64px rail）+ 顶部工具栏 + 内容区
// 平板/手机（<1024px）：抽屉式导航（AdminMobileNav）+ 自适应内容区
// 结构：.admin-root（设计作用域，admin.css）→ ToastProvider → 布局栅格
// 键盘：Tab 导航 / Enter 确认 / ESC 关闭抽屉与弹窗 / 焦点环清晰（focus-visible ring）

import * as React from "react"
import { usePathname } from "next/navigation"
import type { AdminSessionInfo } from "@/lib/admin/ui/api-client"
import { buildNav } from "@/lib/admin/ui/navigation"
import { AdminSidebar } from "./AdminSidebar"
import { AdminTopbar } from "./AdminTopbar"
import { AdminBreadcrumb } from "./AdminBreadcrumb"
import { AdminMobileNav } from "./AdminMobileNav"
import { ToastProvider } from "../feedback/ToastProvider"

const GROUPS_STORAGE_KEY = "facai8_admin_nav_expanded"

/** 读取上次展开的分组（刷新后保持导航状态，§5.1.8） */
function readExpandedGroups(): Set<string> {
  const out = new Set<string>()
  try {
    const raw = sessionStorage.getItem(GROUPS_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const g of parsed) if (typeof g === "string") out.add(g)
      }
    }
  } catch {
    /* sessionStorage 不可用时忽略（隐私模式等） */
  }
  return out
}

interface Props {
  admin: AdminSessionInfo
  children: React.ReactNode
}

export function AdminShell({ admin, children }: Props) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(() => new Set())

  const nav = React.useMemo(() => buildNav(admin.permissions), [admin.permissions])
  const groupLabels = React.useMemo(() => nav.filter((n) => Array.isArray((n as { items?: unknown[] }).items)).map((n) => n.label), [nav])

  // 初始展开：持久化状态 ∪ 当前路由所在分组（刷新后导航状态正确）
  React.useEffect(() => {
    const saved = readExpandedGroups()
    setExpandedGroups((cur) => {
      const next = new Set(cur)
      for (const g of saved) next.add(g)
      return next
    })
  }, [groupLabels, pathname])

  // 路由变化时自动展开当前所在分组（从侧边栏进入 P6 页面的正确高亮/展开状态）
  React.useEffect(() => {
    const hit = nav.find((n) => Array.isArray((n as { items?: { href?: string }[] }).items) && (n as { items: { href?: string }[] }).items.some((i) => i.href === pathname))
    if (hit) {
      setExpandedGroups((cur) => {
        if (cur.has(hit.label)) return cur
        const next = new Set(cur)
        next.add(hit.label)
        return next
      })
      try {
        sessionStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify([...new Set([...groupLabels])]))
      } catch {
        /* ignore */
      }
    }
  }, [nav, pathname, groupLabels])

  function toggleGroup(label: string) {
    setExpandedGroups((cur) => {
      const next = new Set(cur)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
    try {
      sessionStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify([...expandedGroups, label]))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="admin-root flex min-h-screen flex-col">
      <ToastProvider>
        <div className="flex min-h-screen">
          <AdminSidebar
            nav={nav}
            pathname={pathname}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((v) => !v)}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopbar
              admin={admin}
              onOpenMobileNav={() => setMobileOpen(true)}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
            />
            <main className="adm-main admin-scroll min-w-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8 lg:py-6">
              <div className="mx-auto w-full max-w-6xl">
                <AdminBreadcrumb pathname={pathname} permissions={admin.permissions} />
                {children}
              </div>
            </main>
          </div>
          <AdminMobileNav
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            nav={nav}
            pathname={pathname}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
          />
        </div>
      </ToastProvider>
    </div>
  )
}
