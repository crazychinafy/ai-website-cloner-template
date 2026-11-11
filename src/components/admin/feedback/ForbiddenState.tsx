"use client"

// P5：403 权限不足状态（页面级）

import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  title?: string
  description?: string
  /** 返回工作台入口 */
  homeHref?: string
  className?: string
}

export function ForbiddenState({
  title = "没有访问权限",
  description = "当前账号没有访问该页面的权限。如确认应当具备权限，请联系超级管理员分配角色。",
  homeHref = "/admin",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card px-8 py-20 text-center",
        className,
      )}
      role="alert"
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="size-8" aria-hidden />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Link
        href={homeHref}
        className="adm-touch-target inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        返回工作台
      </Link>
    </div>
  )
}
