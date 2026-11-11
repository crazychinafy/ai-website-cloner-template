"use client"

// P5：AdminMobileNav 移动端抽屉导航（<1024px）
// - 覆盖层 + 抽屉；ESC 关闭；打开时焦点移入、关闭返回开关按钮
// - 与桌面侧边栏共用 NavTree（同一权限过滤数据源）

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminNavTop } from "@/lib/admin/ui/navigation"
import { NavTree } from "./NavTree"

interface Props {
  open: boolean
  onClose: () => void
  nav: AdminNavTop[]
  pathname: string
  expandedGroups: Set<string>
  onToggleGroup: (label: string) => void
}

export function AdminMobileNav({ open, onClose, nav, pathname, expandedGroups, onToggleGroup }: Props) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)

  // 打开：记录原焦点并移入抽屉；关闭：归还焦点
  React.useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  return (
    <div className={cn("lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!open}>
      {/* 遮罩 */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-foreground/40 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      {/* 抽屉 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导航菜单"
        className={cn(
          "admin-scroll fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-sidebar shadow-2xl transition-transform duration-200",
          open ? "translate-x-0 animate-drawer-in" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              彩
            </span>
            <span className="text-sm font-semibold">彩搜搜后台</span>
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭导航菜单"
            className="-m-2 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 px-3 py-3">
          <NavTree nav={nav} pathname={pathname} expandedGroups={expandedGroups} onToggleGroup={onToggleGroup} onNavigate={onClose} />
        </div>
      </div>
    </div>
  )
}
