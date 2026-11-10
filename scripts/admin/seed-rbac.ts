// P2：角色与权限 Seed（幂等，事务，可重复执行）
// 权限字典与角色定义以 docs/ADMIN_SYSTEM_SECURITY_AND_TESTING.md §3 为准。
// 语义：
//   - 权限按唯一 code 幂等 upsert（重复执行只刷新字典属性，不新增行）
//   - 系统角色（is_system=1）的权限映射每次按代码中的标准集重算（删旧插新，同一事务）
//   - 非系统角色（管理员自定义）从不触碰
//   - 不创建任何管理员账号（那是 bootstrap-admin.ts 的职责）
// 用法：DB_* 环境变量 + npm run admin:seed
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { z } from "zod"
import mysql from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { eq } from "drizzle-orm"
import { adminPermissions, adminRolePermissions, adminRoles } from "../../src/lib/db/schema/admin-rbac.ts"

// ── 权限字典（42 条，覆盖 12 个资源）─────────────────────────────
type Perm = { code: string; name: string; resource: string; action: string }

const PERMISSIONS: Perm[] = [
  // dashboard
  { code: "dashboard.read", name: "查看仪表盘", resource: "dashboard", action: "read" },
  // categories（4）
  { code: "categories.read", name: "查看网址分类", resource: "categories", action: "read" },
  { code: "categories.create", name: "新建网址分类", resource: "categories", action: "create" },
  { code: "categories.update", name: "编辑网址分类", resource: "categories", action: "update" },
  { code: "categories.delete", name: "删除网址分类", resource: "categories", action: "delete" },
  // links（5）
  { code: "links.read", name: "查看网址", resource: "links", action: "read" },
  { code: "links.create", name: "新建网址", resource: "links", action: "create" },
  { code: "links.update", name: "编辑网址", resource: "links", action: "update" },
  { code: "links.publish", name: "发布/下架网址", resource: "links", action: "publish" },
  { code: "links.delete", name: "删除网址", resource: "links", action: "delete" },
  // articles（5）
  { code: "articles.read", name: "查看文章", resource: "articles", action: "read" },
  { code: "articles.create", name: "新建文章", resource: "articles", action: "create" },
  { code: "articles.update", name: "编辑文章", resource: "articles", action: "update" },
  { code: "articles.publish", name: "发布/归档文章", resource: "articles", action: "publish" },
  { code: "articles.delete", name: "删除文章", resource: "articles", action: "delete" },
  // bulletins（5）
  { code: "bulletins.read", name: "查看公告", resource: "bulletins", action: "read" },
  { code: "bulletins.create", name: "新建公告", resource: "bulletins", action: "create" },
  { code: "bulletins.update", name: "编辑公告", resource: "bulletins", action: "update" },
  { code: "bulletins.publish", name: "发布/归档公告", resource: "bulletins", action: "publish" },
  { code: "bulletins.delete", name: "删除公告", resource: "bulletins", action: "delete" },
  // ads（4）
  { code: "ads.read", name: "查看广告", resource: "ads", action: "read" },
  { code: "ads.create", name: "新建广告", resource: "ads", action: "create" },
  { code: "ads.update", name: "编辑广告", resource: "ads", action: "update" },
  { code: "ads.delete", name: "删除广告", resource: "ads", action: "delete" },
  // tags（4）
  { code: "tags.read", name: "查看标签", resource: "tags", action: "read" },
  { code: "tags.create", name: "新建标签", resource: "tags", action: "create" },
  { code: "tags.update", name: "编辑标签", resource: "tags", action: "update" },
  { code: "tags.delete", name: "删除标签", resource: "tags", action: "delete" },
  // lines（4）
  { code: "lines.read", name: "查看线路", resource: "lines", action: "read" },
  { code: "lines.create", name: "新建线路", resource: "lines", action: "create" },
  { code: "lines.update", name: "编辑线路", resource: "lines", action: "update" },
  { code: "lines.delete", name: "删除线路", resource: "lines", action: "delete" },
  // settings（2）
  { code: "settings.read", name: "查看站点设置", resource: "settings", action: "read" },
  { code: "settings.update", name: "修改站点设置", resource: "settings", action: "update" },
  // administrators（5）
  { code: "administrators.read", name: "查看管理员", resource: "administrators", action: "read" },
  { code: "administrators.create", name: "新建管理员", resource: "administrators", action: "create" },
  { code: "administrators.update", name: "编辑管理员", resource: "administrators", action: "update" },
  { code: "administrators.disable", name: "禁用管理员", resource: "administrators", action: "disable" },
  { code: "administrators.assign_role", name: "分配管理员角色", resource: "administrators", action: "assign_role" },
  // audit_logs（1）
  { code: "audit_logs.read", name: "查看审计日志", resource: "audit_logs", action: "read" },
  // imports（2）
  { code: "imports.preview", name: "预览静态导入", resource: "imports", action: "preview" },
  { code: "imports.execute", name: "执行静态导入", resource: "imports", action: "execute" },
]

// ── 标准角色（4 个）──────────────────────────────────────────────
type Role = { code: string; name: string; description: string; permissions: string[] }

const CONTENT_RESOURCES = ["categories", "links", "articles", "bulletins", "ads", "tags", "lines"]
const allCodes = () => PERMISSIONS.map((p) => p.code)
const codesFor = (resources: string[], actions?: string[]) =>
  PERMISSIONS.filter((p) => resources.includes(p.resource) && (!actions || actions.includes(p.action))).map(
    (p) => p.code,
  )

const ROLES: Role[] = [
  {
    code: "super_admin",
    name: "超级管理员",
    description: "全部权限（系统角色，权限集由 seed 维护）",
    permissions: allCodes(),
  },
  {
    code: "content_admin",
    name: "内容管理员",
    description: "日常内容管理；不可管理管理员、站点设置与导入（系统角色）",
    // 7 个内容资源的全部动作 + 仪表盘只读
    permissions: ["dashboard.read", ...codesFor(CONTENT_RESOURCES)],
  },
  {
    code: "content_editor",
    name: "内容编辑",
    description: "内容编辑；不可发布/删除/管理管理员（系统角色）",
    permissions: ["dashboard.read", ...codesFor(CONTENT_RESOURCES, ["read", "create", "update"])],
  },
  {
    code: "auditor",
    name: "审计员",
    description: "只读；含 imports.preview（dry-run 不写库，见安全文档 §11.4）（系统角色）",
    permissions: [
      ...codesFor(
        ["dashboard", "categories", "links", "articles", "bulletins", "ads", "tags", "lines", "settings", "administrators", "audit_logs"],
        ["read"],
      ),
      "imports.preview",
    ],
  },
]

// ── 执行 ─────────────────────────────────────────────────────────
const dbEnvSchema = z.object({
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default("facai8_admin"),
  DB_USER: z.string().min(1).default("facai8_app"),
  DB_PASSWORD: z.string().default(""),
})

export type SeedReport = {
  permissions: number
  roles: number
  rolePermissions: Record<string, number>
}

/**
 * 在给定 drizzle 实例上执行 seed（幂等 + 单事务）。
 * 导出供 vitest 集成测试复用；CLI 入口见文件底部。
 */
export async function runSeedRbac(db: MySql2Database<Record<string, never>>): Promise<SeedReport> {
  let report: SeedReport | null = null
  await db.transaction(async (tx) => {
    // 1) 权限字典：按唯一 code 幂等 upsert
    for (const p of PERMISSIONS) {
      await tx
        .insert(adminPermissions)
        .values({ code: p.code, name: p.name, resource: p.resource, action: p.action })
        .onDuplicateKeyUpdate({ set: { name: p.name, resource: p.resource, action: p.action } })
    }

    // 2) 角色：按唯一 code 幂等 upsert（系统角色标准属性）
    for (const r of ROLES) {
      await tx
        .insert(adminRoles)
        .values({ code: r.code, name: r.name, description: r.description, isSystem: true })
        .onDuplicateKeyUpdate({ set: { name: r.name, description: r.description, isSystem: true } })
    }

    // 3) 取回 id 映射
    const permRows = await tx.select({ code: adminPermissions.code, id: adminPermissions.id }).from(adminPermissions)
    const permId = new Map<string, bigint>(permRows.map((r) => [r.code, r.id]))
    const roleRows = await tx.select({ code: adminRoles.code, id: adminRoles.id, isSystem: adminRoles.isSystem }).from(adminRoles)
    const roleId = new Map<string, { id: bigint; isSystem: boolean }>(
      roleRows.map((r) => [r.code, { id: r.id, isSystem: r.isSystem }]),
    )

    // 4) 系统角色：标准权限集重算（删旧插新，同一事务内原子完成）
    //    非系统角色：完全不触碰（管理员自定义权限不受 seed 影响）
    for (const r of ROLES) {
      const role = roleId.get(r.code)
      if (!role) throw new Error(`seed: role ${r.code} missing after upsert`)
      if (!role.isSystem) continue
      const ids = r.permissions.map((code) => permId.get(code)).filter((v): v is bigint => v !== undefined)
      if (ids.length !== r.permissions.length) {
        const missing = r.permissions.filter((code) => !permId.has(code))
        throw new Error(`seed: permission ids missing for role ${r.code}: ${missing.join(", ")}`)
      }
      await tx.delete(adminRolePermissions).where(eq(adminRolePermissions.roleId, role.id))
      if (ids.length > 0) {
        await tx
          .insert(adminRolePermissions)
          .values(ids.map((permissionId) => ({ roleId: role.id, permissionId })))
      }
    }

    // 5) 汇报（读回真实库状态）
    const mapped = await tx
      .select({ role: adminRoles.code, permission: adminPermissions.code })
      .from(adminRolePermissions)
      .innerJoin(adminRoles, eq(adminRolePermissions.roleId, adminRoles.id))
      .innerJoin(adminPermissions, eq(adminRolePermissions.permissionId, adminPermissions.id))
      .orderBy(adminRoles.code)
    const rolePermissions: Record<string, number> = {}
    for (const m of mapped) rolePermissions[m.role] = (rolePermissions[m.role] ?? 0) + 1
    report = {
      permissions: (await tx.select({ id: adminPermissions.id }).from(adminPermissions)).length,
      roles: (await tx.select({ id: adminRoles.id }).from(adminRoles)).length,
      rolePermissions,
    }
  })
  if (!report) throw new Error("seed: transaction produced no report")
  return report
}

async function main(): Promise<void> {
  const env = dbEnvSchema.parse(
    Object.fromEntries(
      Object.keys(process.env)
        .filter((k) => k.startsWith("DB_"))
        .map((k) => [k, process.env[k]]),
    ),
  )
  if (!/^facai8_[a-z0-9_]{1,40}$/.test(env.DB_NAME)) {
    console.error(`[seed-rbac] 拒绝执行：DB_NAME="${env.DB_NAME}" 不在白名单（必须匹配 facai8_*）`)
    process.exit(1)
  }
  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: 5,
    bigNumberStrings: true,
    supportBigNumbers: true,
    timezone: "Z",
    connectTimeout: 10_000,
  })
  try {
    const db = drizzle(pool, { mode: "default" })
    // 前置检查：表必须已存在（先跑 db:migrate）
    try {
      await db.select({ id: adminRoles.id }).from(adminRoles).limit(1)
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : ""
      if (code === "ER_NO_SUCH_TABLE") {
        console.error("[seed-rbac] 角色/权限表不存在，请先执行 npm run db:migrate")
        process.exit(1)
      }
      throw err
    }
    const report = await runSeedRbac(db)
    console.log(
      `[seed-rbac] OK ${env.DB_NAME}: permissions=${report.permissions} roles=${report.roles}` +
        Object.entries(report.rolePermissions)
          .map(([role, n]) => ` ${role}=${n}权限`)
          .join(""),
    )
    for (const r of ROLES) {
      const codes = r.permissions
      console.log(`  ${r.code} (${r.name}): ${codes.length} 条`)
    }
  } finally {
    await pool.end()
  }
}

// 仅在直接执行时运行 CLI（vitest 导入本模块时不触发）
const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isDirectRun) {
  main().catch((err) => {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : ""
    console.error(`[seed-rbac] FAIL ${code || "error"}: ${err?.message ?? String(err)}`)
    process.exit(1)
  })
}
