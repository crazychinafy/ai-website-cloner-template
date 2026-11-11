// P5：面包屑构建（纯函数模块，服务端/客户端通用）
// ─────────────────────────────────────────────────────────────────
// 规则（任务书 §8）：
// - 当前页面为最后一级，不生成链接；
// - 父级分组（如"内容管理"）不是路由，只展示文案，不生成链接；
// - 只有已实现的页面（如 /admin）生成可点击链接；
// - 不允许把 URL 原始路径直接作为用户可见标题（未注册路径回退为单一"工作台"）；
// - "工作台"不重复出现。

import { buildNav, isNavGroup } from "./navigation"
import type { AdminNavTop } from "./navigation"

export interface Crumb {
  /** 用户可见标题（中文，绝不使用原始 URL 片段） */
  label: string
  /** 可点击路由（仅已实现页面；当前页为 undefined） */
  href?: string
}

/** 特殊页面标题映射（非业务模块） */
const PAGE_TITLES: Record<string, string> = {
  "/admin/forbidden": "权限不足",
}

/** 后台根路径（面包屑起点） */
const ROOT = "/admin"

interface NavLeafInfo {
  label: string
  href?: string
  groupLabel?: string
}

/** 由可见导航树展开"路由 → 叶子信息"映射 */
function leafIndex(nav: AdminNavTop[]): Map<string, NavLeafInfo> {
  const map = new Map<string, NavLeafInfo>()
  for (const node of nav) {
    if (!isNavGroup(node)) {
      if (node.href) map.set(node.href, { label: node.label, href: node.href })
      continue
    }
    for (const item of node.items) {
      if (item.href) map.set(item.href, { label: item.label, href: item.href, groupLabel: node.label })
    }
  }
  return map
}

/**
 * 由当前 pathname 生成面包屑。
 * @param pathname 当前路径（/admin 前缀）
 * @param nav 权限过滤后的导航树（buildNav 产物）
 */
export function buildBreadcrumb(pathname: string, nav: AdminNavTop[]): Crumb[] {
  const crumbs: Crumb[] = []
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname

  // 根页面：单级"工作台"（当前页，无链接）
  if (clean === ROOT) return [{ label: "工作台" }]

  if (!clean.startsWith(ROOT + "/")) {
    // 非后台路径（理论上不会进入 admin 布局）：只给可安全返回的起点
    return [{ label: "工作台", href: ROOT }]
  }

  crumbs.push({ label: "工作台", href: ROOT })

  // 特殊页面（如 403 视图）
  if (PAGE_TITLES[clean]) {
    crumbs.push({ label: PAGE_TITLES[clean] })
    return crumbs
  }

  // 导航注册页面：工作台 / 分组 / 页面
  const leaf = leafIndex(nav).get(clean)
  if (leaf) {
    if (leaf.groupLabel) crumbs.push({ label: leaf.groupLabel })
    crumbs.push({ label: leaf.label })
    return crumbs
  }

  // 未注册路径：不暴露原始路径片段，保持单一"工作台"
  return [{ label: "工作台", href: ROOT }]
}

/** 便捷入口：由权限直接构建（客户端 usePathname 场景） */
export function buildBreadcrumbFor(permissions: string[], pathname: string): Crumb[] {
  return buildBreadcrumb(pathname, buildNav(permissions))
}
