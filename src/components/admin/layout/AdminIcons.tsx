// P5：后台导航图标映射（lucide；统一 18px 导航 / 16px 按钮）

import * as React from "react"
import {
  Folder,
  FolderTree,
  Image,
  LayoutDashboard,
  Link2,
  Lock,
  Megaphone,
  Route,
  ScrollText,
  Settings,
  Shield,
  Tag,
  Upload,
  Users,
} from "lucide-react"
import type { AdminIconKey } from "@/lib/admin/ui/navigation"

export const ADMIN_ICONS: Record<AdminIconKey, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard,
  folder: Folder,
  "folder-tree": FolderTree,
  link: Link2,
  tag: Tag,
  "file-text": LayoutDashboard,
  megaphone: Megaphone,
  image: Image,
  route: Route,
  settings: Settings,
  users: Users,
  shield: Shield,
  "scroll-text": ScrollText,
  upload: Upload,
  lock: Lock,
}

/** file-text 语义图标（文章）：单独导出避免与"文件"混淆 */
import { FileText } from "lucide-react"
ADMIN_ICONS["file-text"] = FileText
