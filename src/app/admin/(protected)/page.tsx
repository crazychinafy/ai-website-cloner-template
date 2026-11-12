// /admin（P7 工作台）：真实 DB 统计仪表盘（无虚构数字，§2）
// ─────────────────────────────────────────────────────────────────
// - 统计数字全部来自 dashboard-service（SQL COUNT 聚合、单往返、按 Session 权限过滤）
// - 每个指标带「口径」标注；数据库异常显示「数据库连接异常/统计暂不可用」而非 0
// - 权限字典数量为 admin_permissions 实时 COUNT（修复旧版硬编码「权限 46 项」）
// - 最近导入 = ORDER BY id DESC LIMIT 1（修复旧版 count+offset 竞态）
// - 模块总览与权限表沿用真实导航配置与真实 Session 数据
import { requireAdminPage } from "@/lib/admin/auth/guards.ts"
import { getContentSource } from "@/lib/admin/validation/env"
import { getDashboardData, DB_UNAVAILABLE_TEXT } from "@/lib/admin/services/dashboard-service.ts"
import type { DashboardMetric } from "@/lib/admin/services/dashboard-service.ts"
import { ADMIN_NAV, buildNav, isNavGroup } from "@/lib/admin/ui/navigation"
import { PermissionsTable } from "@/components/admin/home/PermissionsTable"
import { StatusBadge } from "@/components/admin/feedback/StatusBadge"
import { getDrizzle } from "@/lib/db/client"
import { adminRoles } from "@/lib/db/schema/admin-rbac.ts"

export const metadata = { title: "工作台 - 彩搜搜后台" }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function MetricTile({ metric }: { metric: DashboardMetric }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/60 p-4">
      <p className="text-2xl font-semibold text-foreground tabular-nums">
        {metric.value.toLocaleString("zh-CN")}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{metric.label}</span>
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.caliber}</p>
    </div>
  )
}

export default async function AdminHomePage() {
  const admin = await requireAdminPage()
  const [dash, roleRows] = await Promise.all([
    getDashboardData(admin.permissions),
    (async () => {
      try {
        const db = getDrizzle()
        return await db.select({ code: adminRoles.code, name: adminRoles.name }).from(adminRoles).limit(20)
      } catch {
        return [] as { code: string; name: string }[]
      }
    })(),
  ])
  const contentSource = getContentSource()
  const visibleNav = buildNav(admin.permissions)
  const roleNames = new Map(
    roleRows.filter((r) => admin.roles.includes(r.code)).map((r) => [r.code, r.name] as const),
  )
  const canSeeRuns = admin.permissions.includes("imports.preview")
  const canSeeSystem = dash.system.length > 0

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
        <StatusBadge tone="neutral">独立后台框架 · P7</StatusBadge>
      </div>

      {/* 数据库状态横幅：异常时明确告知，不以 0 冒充数据 */}
      {!dash.dbOk && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {DB_UNAVAILABLE_TEXT}
        </p>
      )}

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
          {canSeeRuns ? (
            dash.dbOk ? (
              dash.latestRun ? (
                <>
                  <p className="text-sm text-foreground">
                    最近一次（#{dash.latestRun.id}）：
                    <StatusBadge tone={dash.latestRun.status === "succeeded" ? "success" : "danger"}>
                      {dash.latestRun.status}
                    </StatusBadge>
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground break-all">
                    {dash.latestRun.snapshotVersion} · {dash.latestRun.startedAt}（UTC）· 共 {dash.runsTotal} 次（成功{" "}
                    {dash.runsSucceeded} 次）· 口径：admin_import_runs 按 id 倒序最新 1 条
                  </p>
                </>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  尚无导入记录（后台「数据导入」或 P4 CLI 执行后生成）
                </p>
              )
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">{DB_UNAVAILABLE_TEXT}</p>
            )
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">无查看权限（需 imports.preview）</p>
          )}
        </Card>
        <Card title="管理员规模">
          {canSeeSystem && dash.dbOk ? (
            <>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {(dash.system.find((m) => m.key === "admins")?.value ?? 0).toLocaleString("zh-CN")}
                <span className="ml-1 text-xs font-normal text-muted-foreground">名管理员</span>
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                角色 {(dash.system.find((m) => m.key === "roles")?.value ?? 0).toLocaleString("zh-CN")} 个 · 权限{" "}
                {(dash.system.find((m) => m.key === "permissions")?.value ?? 0).toLocaleString("zh-CN")} 项 ·
                口径：admin_users / admin_roles / admin_permissions 实时 COUNT
              </p>
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {canSeeSystem ? DB_UNAVAILABLE_TEXT : "无查看权限（需 administrators.read）"}
            </p>
          )}
        </Card>
      </div>

      {/* 内容数据统计（P7：按 Session 权限过滤；每项带口径标注；DB 异常显示不可用而非 0） */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">内容数据统计（按你的权限显示）</h2>
        {!dash.dbOk ? (
          <p className="text-sm text-muted-foreground">{DB_UNAVAILABLE_TEXT}</p>
        ) : dash.content.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前权限未包含任何内容模块的 read 权限，无可统计项。</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dash.content.map((m) => (
              <MetricTile key={m.key} metric={m} />
            ))}
          </div>
        )}
      </section>

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
