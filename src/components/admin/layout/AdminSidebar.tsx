"use client"

// P5：AdminSidebar 桌面侧边导航（≥1024px 显示；平板可收起为 icon rail）

import * as React from "react"
import { cn } from "@/lib/utils"
import type { AdminNavTop } from "@/lib/admin/ui/navigation"
import { NavTree } from "./NavTree"

interface Props {
  nav: AdminNavTop[]
  pathname: string
  collapsed: boolean
  onToggleCollapsed: () => void
  expandedGroups: Set<string>
  onToggleGroup: (label: string) => void
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4", collapsed && "justify-center px-0")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        彩
      </span>
      {!collapsed ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">彩搜搜后台</span>
          <span className="block truncate text-xs text-muted-foreground">Admin Console</span>
        </span>
      ) : null}
    </div>
  )
}

export function AdminSidebar({ nav, pathname, collapsed, onToggleCollapsed, expandedGroups, onToggleGroup }: Props) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
      aria-label="侧边导航"
    >
      <Brand collapsed={collapsed} />
      <div className={cn("admin-scroll min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        <NavTree
          nav={nav}
          pathname={pathname}
          collapsed={collapsed}
          expandedGroups={expandedGroups}
          onToggleGroup={onToggleGroup}
        />
      </div>
      <div className={cn("shrink-0 border-t border-border p-3", collapsed && "hidden")}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="adm-nav-item flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m11 17-5-5 5-5" />
            <path d="m18 17-5-5 5-5" />
          </svg>
          收起导航
        </button>
      </div>
    </aside>
  )
}
