"use client"

// P5：AdminTopbar 顶部工具栏（64px）
// - 移动端：侧边菜单开关（抽屉）
// - 桌面端：导航收起切换
// - 当前管理员：用户名 + 角色 + 用户菜单（修改密码 / 退出登录）
// - 退出登录调用 POST /api/admin/v1/auth/logout（CSRF）→ 服务端撤销 Session → 回登录页

import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import Link from "next/link"
import { ChevronDown, KeyRound, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { adminApi } from "@/lib/admin/ui/api-client"
import type { AdminSessionInfo } from "@/lib/admin/ui/api-client"
import { useToast } from "../feedback/ToastProvider"

interface Props {
  admin: AdminSessionInfo
  onOpenMobileNav: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function AdminTopbar({ admin, onOpenMobileNav, collapsed, onToggleCollapsed }: Props) {
  const { toast } = useToast()
  const [loggingOut, setLoggingOut] = React.useState(false)

  const initial = (admin.displayName || admin.username).trim().slice(0, 1) || "?"
  const roleLabel = admin.roles.length > 0 ? admin.roles.join(" / ") : "未分配角色"

  async function handleLogout() {
    if (loggingOut) return // 防重复点击
    setLoggingOut(true)
    toast.info("正在退出登录…")
    try {
      await adminApi.logout(admin.csrfToken)
    } catch {
      /* 网络失败也继续跳转（服务端 Session 由 TTL 兜底撤销） */
    }
    // replace：历史栈不保留已失效的后台视图（防"后退"复活）
    window.location.replace("/admin/login")
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
      {/* 移动端：打开抽屉导航 */}
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="打开导航菜单"
        aria-haspopup="dialog"
        className="adm-touch-target -m-2 inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden"
      >
        <MenuIcon className="size-5" aria-hidden />
      </button>

      {/* 桌面端：收起/展开侧边导航 */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "展开侧边导航" : "收起侧边导航"}
        aria-pressed={!collapsed}
        className="adm-touch-target -m-2 hidden size-10 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 lg:inline-flex"
      >
        {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
      </button>

      {/* 移动端品牌（桌面品牌在侧边栏） */}
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          彩
        </span>
        <span className="truncate text-sm font-semibold">彩搜搜后台</span>
      </div>

      {/* 用户区 */}
      <div className="ml-auto flex items-center gap-2">
        <Menu.Root>
          <Menu.Trigger
            aria-label={`当前管理员 ${admin.displayName}，打开用户菜单`}
            className={cn(
              "adm-touch-target flex h-10 items-center gap-2.5 rounded-md pr-2 pl-2.5 outline-none transition-colors",
              "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
              aria-hidden
            >
              {initial}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-36 truncate text-sm font-medium text-foreground">{admin.displayName}</span>
              <span className="block max-w-36 truncate text-xs text-muted-foreground">{roleLabel}</span>
            </span>
            <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6}>
              <Menu.Popup
                className="z-50 w-52 overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl animate-scale-in outline-none"
              >
                <div className="border-b border-border px-3 pt-2 pb-2.5">
                  <p className="truncate text-sm font-medium">{admin.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{admin.username} · {roleLabel}</p>
                </div>
                <Menu.Item
                  render={
                    <Link
                      href="/admin/change-password"
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                    >
                      <KeyRound className="size-4" aria-hidden />
                      修改密码
                    </Link>
                  }
                />
                <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
                <Menu.Item
                  disabled={loggingOut}
                  onClick={(e) => {
                    e.preventDefault()
                    void handleLogout()
                  }}
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-destructive outline-none data-[highlighted]:bg-destructive/10 disabled:opacity-55"
                >
                  <LogOut className="size-4" aria-hidden />
                  {loggingOut ? "退出中…" : "退出登录"}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  )
}
