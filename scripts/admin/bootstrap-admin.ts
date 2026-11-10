// P2：初始化管理员 Bootstrap CLI（仅用于第一次创建超级管理员）
// 用法：
//   ADMIN_BOOTSTRAP_USERNAME=... ADMIN_BOOTSTRAP_PASSWORD=*** npm run admin:bootstrap
// 安全语义：
//   - 密码必须 ≥12 位且不在常见弱口令表；缺密码立即报错，绝无默认密码回退
//   - 密码以 Argon2id 哈希落库；任何输出不含明文密码/hash
//   - 已存在 super_admin 用户 → 明确安全退出（no-op，exit 0），绝不重置密码
//   - 用户名冲突（任意状态用户）→ 拒绝（exit 1）
//   - 创建 + 角色关联在同一事务；must_change_password=1（首登强制改密）
//   - 前置条件：已执行 db:migrate 与 admin:seed（需要 admin_users 与 super_admin 角色）
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { z } from "zod"
import mysql from "mysql2/promise"
import { drizzle } from "drizzle-orm/mysql2"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { and, eq, isNull } from "drizzle-orm"
import argon2 from "argon2"
import { adminRoles, adminUserRoles } from "../../src/lib/db/schema/admin-rbac.ts"
import { adminUsers } from "../../src/lib/db/schema/admin.ts"

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/
// 常见弱口令（小写比较）；命中即拒绝
const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "admin",
  "admin123",
  "admin1234",
  "admin888",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "iloveyou",
  "abc123",
  "root",
  "root123",
  "111111",
  "000000",
  "changeme",
])

const dbEnvSchema = z.object({
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default("facai8_admin"),
  DB_USER: z.string().min(1).default("facai8_app"),
  DB_PASSWORD: z.string().default(""),
})

export type BootstrapOutcome =
  | { status: "created"; id: bigint; username: string; displayName: string; mustChangePassword: boolean }
  | { status: "already_bootstrapped"; existingSuperAdmins: number }
  | { status: "refused"; reason: string }

/**
 * 执行 bootstrap（导出供 vitest 集成测试复用；读 process.env 的 ADMIN_BOOTSTRAP_*）。
 */
export async function runBootstrap(db: MySql2Database<Record<string, never>>): Promise<BootstrapOutcome> {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim()
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim() || username || ""

  // 1) 完整性检查（不触库）
  if (!username || !USERNAME_RE.test(username)) {
    return {
      status: "refused",
      reason: "ADMIN_BOOTSTRAP_USERNAME 缺失或非法（3-64 位字母数字，可含 _ . -，首字符须字母数字）",
    }
  }
  if (!password || password.length < 12) {
    return { status: "refused", reason: "ADMIN_BOOTSTRAP_PASSWORD 缺失或短于 12 位（无默认密码回退）" }
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { status: "refused", reason: "密码命中常见弱口令表，请改用密码管理器生成的长随机密码" }
  }
  if (!displayName) {
    return { status: "refused", reason: "DISPLAY_NAME 无法推导" }
  }

  // 2) 前置结构检查
  try {
    await db.select({ id: adminUsers.id }).from(adminUsers).limit(1)
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : ""
    if (code === "ER_NO_SUCH_TABLE") {
      return { status: "refused", reason: "admin_users 表不存在，请先执行 db:migrate 与 admin:seed" }
    }
    throw err
  }

  // super_admin 角色必须存在（seed 产物）
  const role = await db.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.code, "super_admin")).limit(1)
  if (role.length !== 1) {
    return { status: "refused", reason: "super_admin 角色不存在，请先执行 admin:seed" }
  }
  const superRoleId = role[0].id

  // 3) 已存在 active 超级管理员 → 安全退出（no-op，不重置任何密码）
  const superAdmins = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .innerJoin(adminUserRoles, eq(adminUsers.id, adminUserRoles.userId))
    .where(and(eq(adminUserRoles.roleId, superRoleId), eq(adminUsers.status, "active"), isNull(adminUsers.deletedAt)))
  if (superAdmins.length > 0) {
    return { status: "already_bootstrapped", existingSuperAdmins: superAdmins.length }
  }

  // 4) 用户名冲突（任意状态）→ 拒绝
  const collision = await db
    .select({ id: adminUsers.id, status: adminUsers.status })
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1)
  if (collision.length > 0) {
    return { status: "refused", reason: `用户名 "${username}" 已存在（status=${collision[0].status}）；不允许静默重置密码` }
  }

  // 5) Argon2id 哈希（明文密码仅在此刻参与哈希，随后不再引用）
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

  // 6) 事务：创建用户 + 关联 super_admin（id 以唯一 username 回查，不依赖自增返回）
  let created: Extract<BootstrapOutcome, { status: "created" }> | null = null
  await db.transaction(async (tx) => {
    await tx
      .insert(adminUsers)
      .values({
        username,
        email: null,
        passwordHash,
        displayName,
        status: "active",
        mustChangePassword: true,
        lastLoginAt: null,
        passwordChangedAt: null,
        deletedAt: null,
      })
    const rows = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1)
    const id = rows[0]?.id
    if (id === undefined) throw new Error("insert admin_users 后按 username 回查不到新记录")
    await tx.insert(adminUserRoles).values({ userId: id, roleId: superRoleId })
    created = { status: "created", id, username, displayName, mustChangePassword: true }
  })
  if (!created) throw new Error("bootstrap transaction produced no result")
  return created
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  if (!username || !password) {
    console.error("[bootstrap] 缺少 ADMIN_BOOTSTRAP_USERNAME 或 ADMIN_BOOTSTRAP_PASSWORD；拒绝回退默认密码")
    process.exit(2)
  }

  const env = dbEnvSchema.parse(
    Object.fromEntries(
      Object.keys(process.env)
        .filter((k) => k.startsWith("DB_"))
        .map((k) => [k, process.env[k]]),
    ),
  )
  if (!/^facai8_[a-z0-9_]{1,40}$/.test(env.DB_NAME)) {
    console.error(`[bootstrap] 拒绝执行：DB_NAME="${env.DB_NAME}" 不在白名单（必须匹配 facai8_*）`)
    process.exit(1)
  }
  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionLimit: 2,
    bigNumberStrings: true,
    supportBigNumbers: true,
    timezone: "Z",
    connectTimeout: 10_000,
  })
  try {
    const db = drizzle(pool, { mode: "default" })
    const outcome = await runBootstrap(db)
    switch (outcome.status) {
      case "created":
        console.log("[bootstrap] 管理员创建成功：")
        console.log(`  id=${String(outcome.id)} username=${outcome.username} displayName=${outcome.displayName}`)
        console.log(`  status=active must_change_password=${outcome.mustChangePassword} role=super_admin`)
        console.log("  请立即清除 ADMIN_BOOTSTRAP_USERNAME / ADMIN_BOOTSTRAP_PASSWORD 环境变量")
        break
      case "already_bootstrapped":
        console.log(`[bootstrap] 已存在 ${outcome.existingSuperAdmins} 个 active 超级管理员；未做任何修改（no-op）`)
        break
      case "refused":
        console.error(`[bootstrap] 拒绝执行：${outcome.reason}`)
        process.exitCode = 1
        break
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
    console.error(`[bootstrap] FAIL ${code || "error"}: ${err?.message ?? String(err)}`)
    process.exit(1)
  })
}
