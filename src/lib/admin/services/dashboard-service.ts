// P7：仪表盘 Service（真实 DB 统计；无虚构数字；无 N+1）
// ─────────────────────────────────────────────────────────────────
// 合同（P7 任务书 §Dashboard）：
//   - 全部数字来自 SQL COUNT 聚合（一次 SELECT (子查询)… 往返，非逐表 N+1）
//   - 每个指标附「口径」说明（统计的是什么行、按什么条件过滤）
//   - 指标按当前 Session 权限过滤：没有 xxx.read 就不查也不显示（口径 = 权限边界）
//   - 数据库异常 → dbOk=false：UI 必须显示「数据库连接异常/统计暂不可用」，绝不显示 0
//     （catch→0 会把故障伪装成空数据，禁止）
//   - 权限字典数量 = admin_permissions 真实 COUNT（修复旧版硬编码「权限 46 项」）
//   - 最近导入 = ORDER BY id DESC LIMIT 1（修复旧版 count + offset 两条查询的竞态缺陷）
import "server-only"
import { desc } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { adminImportRuns } from "@/lib/db/schema"

export const DB_UNAVAILABLE_TEXT = "数据库连接异常/统计暂不可用"

export interface DashboardMetric {
  key: string
  label: string
  value: number
  /** 统计口径（数据含义与过滤条件；让用户知道数字是什么） */
  caliber: string
}

export interface DashboardLatestRun {
  id: string
  snapshotVersion: string
  status: string
  startedAt: string
  startedBy: string | null
}

export interface DashboardData {
  /** false = DB 不可用；此时 content/system/runs 均为空/null，UI 显示不可用文案 */
  dbOk: boolean
  content: DashboardMetric[]
  system: DashboardMetric[]
  latestRun: DashboardLatestRun | null
  runsTotal: number | null
  runsSucceeded: number | null
}

interface MetricDef {
  key: string
  perm: string
  label: string
  /** 子查询（表名/条件全部硬编码常量，无用户输入 → 拼接安全） */
  subquery: string
  caliber: string
}

const CONTENT_METRICS: MetricDef[] = [
  {
    key: "links",
    perm: "links.read",
    label: "网址",
    subquery: "select count(*) from site_links where deleted_at is null",
    caliber: "site_links 未删除行数（deleted_at IS NULL）",
  },
  {
    key: "links_published",
    perm: "links.read",
    label: "已发布网址",
    subquery: "select count(*) from site_links where deleted_at is null and status = 'published'",
    caliber: "site_links 未删除且 status='published'",
  },
  {
    key: "articles",
    perm: "articles.read",
    label: "文章",
    subquery: "select count(*) from articles where deleted_at is null",
    caliber: "articles 未删除行数（deleted_at IS NULL）",
  },
  {
    key: "articles_published",
    perm: "articles.read",
    label: "已发布文章",
    subquery: "select count(*) from articles where deleted_at is null and status = 'published'",
    caliber: "articles 未删除且 status='published'",
  },
  {
    key: "bulletins",
    perm: "bulletins.read",
    label: "公告",
    subquery: "select count(*) from bulletins where deleted_at is null",
    caliber: "bulletins 未删除行数",
  },
  {
    key: "ads",
    perm: "ads.read",
    label: "广告",
    subquery: "select count(*) from ads where deleted_at is null",
    caliber: "ads 未删除行数",
  },
  {
    key: "link_categories",
    perm: "categories.read",
    label: "网址分类",
    subquery: "select count(*) from link_categories where deleted_at is null",
    caliber: "link_categories 未删除行数（两级合计）",
  },
  {
    key: "article_categories",
    perm: "article_categories.read",
    label: "文章分类",
    subquery: "select count(*) from article_categories where deleted_at is null",
    caliber: "article_categories 未删除行数",
  },
  {
    key: "tags",
    perm: "tags.read",
    label: "标签",
    subquery: "select count(*) from site_tags where deleted_at is null",
    caliber: "site_tags 未删除行数",
  },
  {
    key: "lines",
    perm: "lines.read",
    label: "线路",
    subquery: "select count(*) from site_lines where deleted_at is null",
    caliber: "site_lines 未删除行数",
  },
  {
    key: "settings",
    perm: "settings.read",
    label: "站点设置",
    subquery: "select count(*) from site_settings",
    caliber: "site_settings 键数量（设置无软删除）",
  },
]

const SYSTEM_METRICS: MetricDef[] = [
  {
    key: "admins",
    perm: "administrators.read",
    label: "管理员",
    subquery: "select count(*) from admin_users",
    caliber: "admin_users 全部账号（含停用）",
  },
  {
    key: "roles",
    perm: "administrators.read",
    label: "角色",
    subquery: "select count(*) from admin_roles",
    caliber: "admin_roles 全部角色（含系统角色）",
  },
  {
    key: "permissions",
    perm: "administrators.read",
    label: "权限字典",
    subquery: "select count(*) from admin_permissions",
    caliber: "admin_permissions 权限码总数（DB 实时 COUNT，非硬编码）",
  },
]

function toCount(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 一次聚合查询取全部授权指标（单往返；权限外的指标不查询）。
 * 任何 DB 错误 → dbOk=false（不吞错、不返回 0）。
 */
export async function getDashboardData(permissions: string[], db: AdminDb = getDrizzle()): Promise<DashboardData> {
  const contentDefs = CONTENT_METRICS.filter((m) => permissions.includes(m.perm))
  const systemDefs = SYSTEM_METRICS.filter((m) => permissions.includes(m.perm))
  const canSeeRuns = permissions.includes("imports.preview")

  try {
    const selects: string[] = []
    for (const m of [...contentDefs, ...systemDefs]) selects.push(`(${m.subquery}) as \`${m.key}\``)
    if (canSeeRuns) {
      selects.push("(select count(*) from admin_import_runs) as `__runs_total`")
      selects.push("(select count(*) from admin_import_runs where status = 'succeeded') as `__runs_succeeded`")
    }

    const contentValues: Record<string, number> = {}
    const systemValues: Record<string, number> = {}
    let runsTotal: number | null = null
    let runsSucceeded: number | null = null

    if (selects.length > 0) {
      const raw = await db.execute(sql.raw(`select ${selects.join(", ")}`))
      const rows = (Array.isArray(raw) ? (raw as unknown[])[0] : raw) as Record<string, unknown>[]
      const row = rows[0] ?? {}
      for (const m of contentDefs) contentValues[m.key] = toCount(row[m.key])
      for (const m of systemDefs) systemValues[m.key] = toCount(row[m.key])
      if (canSeeRuns) {
        runsTotal = toCount(row.__runs_total)
        runsSucceeded = toCount(row.__runs_succeeded)
      }
    }

    // 最近一次导入（含 CLI 触发）：ORDER BY id DESC LIMIT 1（一次查询，无竞态）
    let latestRun: DashboardLatestRun | null = null
    if (canSeeRuns) {
      const rows = await db
        .select({
          id: adminImportRuns.id,
          snapshotVersion: adminImportRuns.snapshotVersion,
          status: adminImportRuns.status,
          startedAt: adminImportRuns.startedAt,
          startedBy: adminImportRuns.startedBy,
        })
        .from(adminImportRuns)
        .orderBy(desc(adminImportRuns.id))
        .limit(1)
      const r = rows[0]
      if (r) {
        latestRun = {
          id: r.id.toString(),
          snapshotVersion: r.snapshotVersion,
          status: r.status,
          startedAt: r.startedAt,
          startedBy: r.startedBy?.toString() ?? null,
        }
      }
    }

    return {
      dbOk: true,
      content: contentDefs.map((m) => ({ key: m.key, label: m.label, value: contentValues[m.key] ?? 0, caliber: m.caliber })),
      system: systemDefs.map((m) => ({ key: m.key, label: m.label, value: systemValues[m.key] ?? 0, caliber: m.caliber })),
      latestRun,
      runsTotal,
      runsSucceeded,
    }
  } catch {
    return { dbOk: false, content: [], system: [], latestRun: null, runsTotal: null, runsSucceeded: null }
  }
}
