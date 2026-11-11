"use client"

// P5：导航树渲染（AdminSidebar 桌面 / AdminMobileNav 移动抽屉 共用）
// - 权限过滤后的 nav（buildNav 产物）作为唯一数据源
// - 当前路由高亮 + aria-current；未开发模块 = "待开放" 徽章，不可交互
// - 分组展开/收起：受控（父组件持有展开集合）；键盘可达

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { isNavGroup } from "@/lib/admin/ui/navigation"
import type { AdminNavTop } from "@/lib/admin/ui/navigation"
import { ADMIN_ICONS } from "./AdminIcons"

interface Props {
  nav: AdminNavTop[]
  /** 当前 pathname（高亮判定） */
  pathname: string
  collapsed?: boolean
  expandedGroups: Set<string>
  onToggleGroup: (label: string) => void
  /** 导航变更后关闭（移动端抽屉用） */
  onNavigate?: () => void
}

function PendingBadge() {
  return (
    <span className="ml-auto rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
      待开放
    </span>
  )
}

export function NavTree({ nav, pathname, collapsed = false, expandedGroups, onToggleGroup, onNavigate }: Props) {
  return (
    <nav className="flex flex-col gap-1" aria-label="后台主导航">
      {nav.map((node) => {
        const Icon = ADMIN_ICONS[node.icon]

        if (!isNavGroup(node)) {
          const active = node.href === pathname
          const base = cn(
            "adm-nav-item relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/50",
            active
              ? "bg-sidebar-active text-sidebar-active-foreground"
              : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
            collapsed && "justify-center px-0",
          )

          if (!node.href) {
            // 理论上不会发生（无 href 的顶层 = 分组）；防御渲染
            return (
              <span key={node.label} className={cn(base, "cursor-default")} title={collapsed ? node.label : undefined}>
                <Icon className="size-4.5 shrink-0" aria-hidden />
                {!collapsed ? <span className="truncate">{node.label}</span> : null}
              </span>
            )
          }

          return (
            <Link
              key={node.href}
              href={node.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? node.label : undefined}
              onClick={onNavigate}
              className={base}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden />
              {!collapsed ? <span className="truncate">{node.label}</span> : null}
              {active ? (
                <span
                  className={cn("absolute right-2.5 size-1.5 rounded-full bg-primary", collapsed && "right-1")}
                  aria-hidden
                />
              ) : null}
            </Link>
          )
        }

        // ── 分组 ──
        const expanded = expandedGroups.has(node.label)
        const hasActiveChild = node.items.some((i) => i.href === pathname)
        const headerClass = cn(
          "adm-nav-item flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          hasActiveChild ? "text-foreground" : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
          collapsed && "justify-center px-0",
        )
        const IconEl = (
          <Icon className={cn("size-4.5 shrink-0", hasActiveChild && "text-sidebar-active-foreground")} aria-hidden />
        )

        if (collapsed) {
          // 收起（icon rail）：点击分组直接展开（桌面端由父组件切换 rail 展开）
          return (
            <button
              key={node.label}
              type="button"
              title={node.label}
              aria-expanded={expanded}
              onClick={() => onToggleGroup(node.label)}
              className={headerClass}
            >
              {IconEl}
            </button>
          )
        }

        return (
          <div key={node.label}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => onToggleGroup(node.label)}
              className={cn(headerClass, "w-full justify-between")}
            >
              <span className="flex min-w-0 items-center gap-3">
                {IconEl}
                <span className="truncate">{node.label}</span>
              </span>
              <ChevronRight
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                aria-hidden
              />
            </button>
            {expanded ? (
              <ul className="mt-1 mb-2 ml-4 flex flex-col gap-1 border-l border-border pl-3">
                {node.items.map((item) => {
                  const ItemIcon = ADMIN_ICONS[item.icon]
                  const active = item.href === pathname
                  if (!item.href) {
                    return (
                      <li key={item.label} className="flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground">
                        <ItemIcon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        <PendingBadge />
                      </li>
                    )
                  }
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(
                          "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors outline-none",
                          "focus-visible:ring-2 focus-visible:ring-ring/50",
                          active
                            ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
                            : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <ItemIcon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        {item.pending ? <PendingBadge /> : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
