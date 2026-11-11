// /admin（P5 后台首页 = 框架欢迎页 + 真实系统状态）
// ─────────────────────────────────────────────────────────────────
// 不伪造任何统计（无 PV/UV/收入等虚构数字，§2）：
// - 系统状态卡片：数据源（CONTENT_SOURCE 真实 env）、会话、导入记录（admin_import_runs 真实行）
// - 权限表：当前 Session 的真实权限（服务端每次请求实时加载）
// - 模块总览：真实导航配置（已实现/待开放）
import { requireAdminPage } from "@/lib/admin/auth/guards.ts"
import { getContentSource } from "@/lib/admin/validation/env"
import { ADMIN_NAV, buildNav, isNavGroup } from "@/lib/admin/ui/navigation"
import { PermissionsTable } from "@/components/admin/home/PermissionsTable"
import { StatusBadge } from "@/components/admin/feedback/StatusBadge"
import { sql } from "drizzle-orm"
import { getDrizzle } from "@/lib/db/client"
import { adminImportRuns } from "@/lib/db/schema"
import { adminRoles } from "@/lib/db/schema/admin-rbac.ts"
import { adminUsers } from "@/lib/db/schema/admin.ts"

export const metadata = { title: "工作台 - 彩搜搜后台" }

interface ImportStatus {
  total: number
  latest: { snapshotVersion: string; status: string; startedAt: string } | null
}

/** 读取真实导入状态（DB 不可用时优雅降级，不阻塞首页） */
async function readImportStatus(): Promise<ImportStatus> {
  try {
    const db = getDrizzle()
    const [countRow] = await db
      .select({ c: sql<number>`count(*)` })
      .from(adminImportRuns)
      .limit(1)
    const total = Number(countRow?.c ?? 0)
    if (total === 0) return { total, latest: null }
    const rows = await db
      .select({
        snapshotVersion: adminImportRuns.snapshotVersion,
        status: adminImportRuns.status,
        startedAt: adminImportRuns.startedAt,
      })
      .from(adminImportRuns)
      .orderBy(adminImportRuns.id)
      .limit(1)
      .offset(Math.max(0, total - 1))
    const r = rows[0]
    return {
      total,
      latest: r ? { snapshotVersion: r.snapshotVersion, status: r.status, startedAt: r.startedAt } : null,
    }
  } catch {
    return { total: 0, latest: null }
  }
}

/** 真实管理员/角色规模（只读；DB 不可用时为 0 显示"不可用"） */
async function readAdminScale() {
  try {
    const db = getDrizzle()
    const [u, r] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(adminUsers).limit(1),
      db.select({ c: sql<number>`count(*)` }).from(adminRoles).limit(1),
    ])
    return {
      admins: Number(u[0]?.c ?? 0),
      roles: Number(r[0]?.c ?? 0),
    }
  } catch {
    return null
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default async function AdminHomePage() {
  const admin = await requireAdminPage()
  const [importStatus, scale] = await Promise.all([readImportStatus(), readAdminScale()])
  const contentSource = getContentSource()
  const visibleNav = buildNav(admin.permissions)
  const roleRows = await (async () => {
    try {
      const db = getDrizzle()
      return await db
        .select({ code: adminRoles.code, name: adminRoles.name })
        .from(adminRoles)
        .limit(20)
    } catch {
      return [] as { code: string; name: string }[]
    }
  })()
  const roleNames = new Map(
    roleRows.filter((r) => admin.roles.includes(r.code)).map((r) => [r.code, r.name] as const),
  )

  return (
    <div className="space-y-6">
      {/* 欢迎区 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">欢迎回来，{admin.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            @{admin.username}
            {admin.roles.length > 0 ? (
              <>
                {" "}
                · 角色：
                {admin.roles.map((code, i) => (
                  <span key={code}>
                    {i > 0 ? "、" : ""}
                    {roleNames.get(code) ?? code}
                  </span>
                ))}
              </>
            ) : (
              " · 未分配角色（仅工作台）"
            )}
          </p>
        </div>
        <StatusBadge tone="neutral">独立后台框架 · P5</StatusBadge>
      </div>

      {/* 系统状态（全部为真实数据） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="数据源 CONTENT_SOURCE">
          <p className="text-sm text-foreground">
            <StatusBadge tone={contentSource === "static" ? "info" : "success"}>{contentSource}</StatusBadge>
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {contentSource === "static"
              ? "前台当前读取静态采集快照（P8 前保持 static）；后台数据写入 MySQL。"
              : "前台正在读取 MySQL 数据源。"}
          </p>
        </Card>
        <Card title="当前会话">
          <p className="text-sm text-foreground">
            过期时间 <span className="font-mono text-[13px]">{admin.expiresAt}</span>（UTC）
          </p>
          <p className="text-xs leading-5 text-muted-foreground">HttpOnly Cookie 服务端 Session；权限每次请求实时校验。</p>
        </Card>
        <Card title="快照导入">
          {importStatus.latest ? (
            <>
              <p className="text-sm text-foreground">
                最近一次：
                <StatusBadge tone={importStatus.latest.status === "succeeded" ? "success" : "danger"}>
                  {importStatus.latest.status}
                </StatusBadge>
              </p>
              <p className="text-xs leading-5 text-muted-foreground break-all">
                {importStatus.latest.snapshotVersion} · {importStatus.latest.startedAt}（UTC）· 共 {importStatus.total} 次
              </p>
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {scale === null ? "导入记录不可用（数据库连接异常）" : "尚无导入记录（P4 导入脚本执行后生成）"}
            </p>
          )}
        </Card>
        <Card title="管理员规模">
          {scale ? (
            <>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {scale.admins}
                <span className="ml-1 text-xs font-normal text-muted-foreground">名管理员</span>
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                角色 {scale.roles} 个（含 4 个系统角色）· 权限 42 项
              </p>
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">不可用（数据库连接异常）</p>
          )}
        </Card>
      </div>

      {/* 模块总览（真实导航配置：已实现/待开放） */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">模块总览</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ADMIN_NAV.map((node) =>
            isNavGroup(node) ? (
              <div key={node.label} className="rounded-md border border-border/70 bg-background/60 p-3">
                <p className="mb-2 text-sm font-medium text-foreground">
                  {node.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {node.items.length} 项
                  </span>
                </p>
                <ul className="space-y-1">
                  {node.items.map((item) => (
                    <li key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      {item.href ? <StatusBadge tone="success" dot={false}>已实现</StatusBadge> : <StatusBadge tone="neutral" dot={false}>待开放</StatusBadge>}
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div key={node.label} className="rounded-md border border-border/70 bg-background/60 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {node.label}
                  {node.href ? <StatusBadge tone="success" dot={false}>已实现</StatusBadge> : <StatusBadge tone="neutral" dot={false}>待开放</StatusBadge>}
                </p>
              </div>
            ),
          )}
        </div>
      </section>

      {/* 当前会话权限（真实 Session 数据；表格组件示例） */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">当前会话权限（每次请求实时加载）</h2>
          <span className="text-xs text-muted-foreground">{visibleNav.length} 个可见模块</span>
        </div>
        <PermissionsTable permissions={admin.permissions} />
      </section>
    </div>
  )
}
