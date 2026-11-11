// P5：后台导航树（纯函数模块，服务端/客户端通用，无副作用）
// ─────────────────────────────────────────────────────────────────
// - 权限代码全部来自 Seed 字典（P6A 后 46 条 / 13 资源），禁止自行编造：
//   dashboard / categories / article_categories / links / articles / bulletins /
//   ads / tags / lines / settings / administrators / audit_logs / imports
// - P5 实现"工作台"；P6A 实现网址分类/文章分类/标签管理；其余模块为
//   未来 P6B-P7 规划，显示为"待开放"（pending，不可点击、不产生死链），不伪造功能。
// - 菜单可见性由 buildNav(permissions) 依据 Session 实时权限过滤，
//   仅用于展示；服务端守卫（guards/require-permission）是唯一安全边界。

export type AdminIconKey =
  | "layout-dashboard"
  | "folder"
  | "link"
  | "tag"
  | "file-text"
  | "folder-tree"
  | "megaphone"
  | "image"
  | "route"
  | "settings"
  | "users"
  | "shield"
  | "scroll-text"
  | "upload"
  | "lock"

export interface AdminNavItem {
  /** 导航文案（中文） */
  label: string
  /** lucide 图标键（客户端映射为组件） */
  icon: AdminIconKey
  /** 页面路由；未开发模块不设置（不产生死链） */
  href?: string
  /** 控制显示的最小权限（Seed 字典 code） */
  permission: string
  /** 未开发模块标记：渲染为"待开放"，不可交互 */
  pending?: boolean
}

export interface AdminNavGroup {
  label: string
  icon: AdminIconKey
  items: AdminNavItem[]
}

/** 顶层节点：独立页面（自带 permission）或分组（无 permission；可见性 = 子项并集） */
export type AdminNavTop = AdminNavItem | (AdminNavGroup & { permission?: never })

/** 判断一个顶层节点是否为分组 */
export function isNavGroup(node: AdminNavTop): node is AdminNavGroup {
  return Array.isArray((node as AdminNavGroup).items)
}

// P6A：文章分类成为独立资源（article_categories.* 权限码，Seed 已含 4 条）。
// 导航项直接使用该权限码；旧版借用 categories.read 的映射已废弃。
export const ARTICLE_CATEGORY_PERMISSION = "article_categories.read"

export const ADMIN_NAV: AdminNavTop[] = [
  {
    label: "工作台",
    icon: "layout-dashboard",
    href: "/admin",
    permission: "dashboard.read",
  },
  {
    label: "内容管理",
    icon: "folder",
    items: [
      { label: "网址分类", icon: "folder", href: "/admin/categories", permission: "categories.read" },
      { label: "网址管理", icon: "link", permission: "links.read", pending: true },
      { label: "标签管理", icon: "tag", href: "/admin/tags", permission: "tags.read" },
      { label: "文章管理", icon: "file-text", permission: "articles.read", pending: true },
      { label: "文章分类", icon: "folder-tree", href: "/admin/article-categories", permission: ARTICLE_CATEGORY_PERMISSION },
      { label: "公告管理", icon: "megaphone", permission: "bulletins.read", pending: true },
    ],
  },
  {
    label: "运营管理",
    icon: "settings",
    items: [
      { label: "广告管理", icon: "image", permission: "ads.read", pending: true },
      { label: "线路管理", icon: "route", permission: "lines.read", pending: true },
      { label: "站点设置", icon: "settings", permission: "settings.read", pending: true },
    ],
  },
  {
    label: "系统管理",
    icon: "shield",
    items: [
      { label: "管理员管理", icon: "users", permission: "administrators.read", pending: true },
      { label: "角色权限", icon: "shield", permission: "administrators.read", pending: true },
      { label: "操作日志", icon: "scroll-text", permission: "audit_logs.read", pending: true },
      { label: "数据导入", icon: "upload", permission: "imports.preview", pending: true },
    ],
  },
]

/**
 * 依据管理员实时权限生成可见导航（§5.1）：
 * - 无对应权限的条目不显示；
 * - 分组仅在存在可见子项时显示；
 * - 未开发（pending）条目保留显示但不可交互（不伪造功能）。
 */
export function buildNav(permissions: string[]): AdminNavTop[] {
  const has = new Set(permissions)
  const out: AdminNavTop[] = []
  for (const node of ADMIN_NAV) {
    if (isNavGroup(node)) {
      const visible = node.items.filter((item) => has.has(item.permission))
      if (visible.length > 0) out.push({ label: node.label, icon: node.icon, items: visible })
      continue
    }
    if (has.has(node.permission)) out.push(node)
  }
  return out
}

/** 全部已实现的页面路由（面包屑 / 高亮用；P6A 起含三个内容模块） */
export const ADMIN_PAGE_ROUTES: ReadonlySet<string> = new Set([
  "/admin",
  "/admin/categories",
  "/admin/article-categories",
  "/admin/tags",
])
