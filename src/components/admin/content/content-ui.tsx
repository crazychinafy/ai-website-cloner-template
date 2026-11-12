"use client"

// P6A：三个内容管理模块（网址分类/文章分类/标签）共用的展示原语
// ─────────────────────────────────────────────────────────────────
// - IconClassPreview：与前台完全一致的渲染方式（<i class="…">，iconfont.css 已在根 layout 全局引入）
// - TagChipPreview：标签前景/背景色 + 图标的真实样式预览
// - RowAction：行操作按钮（统一 P5 风格 + 禁用/加载态）
// - 状态徽章（启用/停用/已删除）与查询串拼装小工具
import * as React from "react"
import { cn } from "@/lib/utils"
import type { LinkStatus } from "@/lib/admin/dto/link"
import type { AdDbStatus, AdEffectiveStatus } from "@/lib/admin/dto/ad"
import { StatusBadge } from "../feedback/StatusBadge"

/** iconfont class 预览；空值显示占位。iconClass 已由服务端 Zod 限制为安全 class token */
export function IconClassPreview({
  iconClass,
  size = 18,
  className,
}: {
  iconClass: string
  size?: number
  className?: string
}) {
  if (!iconClass) {
    return <span className={cn("text-xs text-muted-foreground/70", className)}>—</span>
  }
  return (
    <span
      title={iconClass}
      className={cn("inline-flex h-6 w-6 items-center justify-center rounded bg-muted/60", className)}
    >
      {/* 图标字形本身即预览；aria-hidden 因为 class 名对读屏无意义 */}
      <i className={iconClass} style={{ fontSize: size, lineHeight: 1 }} aria-hidden />
    </span>
  )
}

/** 标签样式预览：按保存的 fg/bg 渲染色板（与前台 LinkCard 标签形态一致） */
export function TagChipPreview({
  name,
  iconClass,
  color,
  bgColor,
}: {
  name: string
  iconClass: string
  color: string
  bgColor: string
}) {
  return (
    <span
      className="inline-flex max-w-44 items-center gap-1 truncate rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: bgColor, border: "1px solid rgba(0,0,0,.08)" }}
      title={`${name} · ${color} on ${bgColor}`}
    >
      {iconClass ? <i className={iconClass} style={{ fontSize: 12 }} aria-hidden /> : null}
      <span className="truncate">{name || "（未命名）"}</span>
    </span>
  )
}

/** 启用/停用徽章 */
export function StatusPill({ status }: { status: "active" | "disabled" }) {
  return status === "active" ? <StatusBadge tone="success">启用</StatusBadge> : <StatusBadge tone="neutral">停用</StatusBadge>
}

/** P6B：网址三态徽章（草稿/已发布/停用） */
export function LinkStatusPill({ status }: { status: LinkStatus }) {
  if (status === "published") return <StatusBadge tone="success">已发布</StatusBadge>
  if (status === "draft") return <StatusBadge tone="info">草稿</StatusBadge>
  return <StatusBadge tone="neutral">停用</StatusBadge>
}

/** P6C：文章/公告三态徽章（草稿/已发布/已归档） */
export function ArticleStatusPill({ status }: { status: "draft" | "published" | "archived" }) {
  if (status === "published") return <StatusBadge tone="success">已发布</StatusBadge>
  if (status === "draft") return <StatusBadge tone="info">草稿</StatusBadge>
  return <StatusBadge tone="neutral">已归档</StatusBadge>
}

/** 已删除徽章（回收站视图） */
export function DeletedPill() {
  return <StatusBadge tone="danger" dot={false}>已删除</StatusBadge>
}

/** 颜色小方块 + HEX 文本 */
export function ColorCell({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <span
        className="inline-block size-4 rounded border border-border"
        style={{ backgroundColor: value }}
        aria-hidden
      />
      {value}
    </span>
  )
}

interface RowActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "danger"
  loading?: boolean
}

/** 表格行内操作按钮（P5 按钮语言的紧凑版） */
export function RowAction({ tone = "default", loading = false, className, children, disabled, ...rest }: RowActionProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "adm-btn adm-touch-target inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-xs font-medium transition-colors outline-none",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        tone === "danger" && "text-destructive hover:bg-destructive/10",
        className,
      )}
      {...rest}
    >
      {loading ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  )
}

/** 主按钮（页面级：新建等） */
export function PrimaryAction({
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "adm-btn adm-touch-target inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors outline-none",
        "hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** 次按钮（视图切换等） */
export function SecondaryAction({
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "adm-btn adm-touch-target inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors outline-none",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** 查询串拼装（跳过空值；Boolean → "true"/"false" 与后端 Zod enum 对齐） */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    sp.set(key, String(value))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

/** 时间展示（DATETIME(3) UTC 墙钟字符串，直接展示；空值占位） */
export function formatTime(value: string | null | undefined): string {
  return value ? value : "—"
}

/**
 * 站内媒体地址解析：legacy `/uploads/...` 路径按 basename 映射到本地静态素材目录
 * （镜像前台冻结的 asset()：public/sites/facai8/images/{原文件名}，与服务端 media-file.ts 同一口径）。
 * 其余站内路径原样返回。
 */
export function resolveMediaSrc(p: string | null | undefined): string | null {
  if (!p) return null
  const trimmed = p.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/uploads/")) {
    const base = decodeURIComponent(trimmed.split("/").pop() || "")
    if (!base) return null
    return `/sites/facai8/images/${base}`
  }
  return trimmed
}

/**
 * P6D：图片路径缩略预览（广告 imagePath / 站点 Logo / favicon）。
 * 地址为站内静态路径；加载失败（文件缺失等）时自动隐藏为占位文案。
 * 只加载站内资源，绝不访问广告目标 URL（§11.1 预览禁令）。
 */
export function MediaPreview({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [src])
  if (!src) return <span className={cn("text-xs text-muted-foreground/70", className)}>—</span>
  if (failed) return <span className={cn("text-xs text-muted-foreground/70", className)}>预览不可用</span>
  const resolved = resolveMediaSrc(src)
  if (!resolved) return <span className={cn("text-xs text-muted-foreground/70", className)}>预览不可用</span>
  return (
    // 后台表单/列表即时预览：站内动态路径未配置 next/image remotePatterns → 用原生 <img>
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn(
        "inline-block h-10 w-16 rounded border border-border bg-muted/40 object-contain align-middle",
        className,
      )}
    />
  )
}

/** P6D：广告数据库状态徽章（draft/active/disabled/expired） */
export function AdStatusPill({ status }: { status: AdDbStatus }) {
  if (status === "active") return <StatusBadge tone="success">启用</StatusBadge>
  if (status === "draft") return <StatusBadge tone="info">草稿</StatusBadge>
  if (status === "expired") return <StatusBadge tone="warning">已过期</StatusBadge>
  return <StatusBadge tone="neutral">停用</StatusBadge>
}

/** P6D：广告有效状态徽章（服务端按排期计算，仅展示，绝不回写 DB） */
export function AdEffectivePill({ status }: { status: AdEffectiveStatus }) {
  if (status === "active") return <StatusBadge tone="success">投放中</StatusBadge>
  if (status === "scheduled") return <StatusBadge tone="info">待投放</StatusBadge>
  if (status === "expired") return <StatusBadge tone="warning">已过期</StatusBadge>
  if (status === "disabled") return <StatusBadge tone="neutral">已停用</StatusBadge>
  return <StatusBadge tone="neutral">草稿</StatusBadge>
}
