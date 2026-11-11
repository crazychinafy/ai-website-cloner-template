"use client"

// P5：AdminBreadcrumb（由 pathname + 权限导航生成）
// - 当前页为最后一级（不可点击、aria-current）
// - 仅已实现页面生成链接；分组名只展示不可点击；不暴露原始路径

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { buildBreadcrumbFor } from "@/lib/admin/ui/breadcrumb"

interface Props {
  pathname: string
  permissions: string[]
}

export function AdminBreadcrumb({ pathname, permissions }: Props) {
  const crumbs = buildBreadcrumbFor(permissions, pathname)
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : crumb.href ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-muted-foreground">{crumb.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
