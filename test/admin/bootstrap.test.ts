// P2 Bootstrap 测试：合法创建 / Argon2id 无明文 / 重复执行 no-op / 缺密码拒绝 / 弱口令拒绝 /
// 用户名冲突拒绝 / 未 seed 时拒绝 / 输出不含明文密码
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Pool } from "mysql2/promise"
import { dropScratch, freshMigratedPool, makeDb } from "./test-db"
import { runBootstrap } from "../../scripts/admin/bootstrap-admin.ts"
import { runSeedRbac } from "../../scripts/admin/seed-rbac.ts"
import * as schema from "../../src/lib/db/schema"
import { eq } from "drizzle-orm"

let pool: Pool
const TEST_PASSWORD = "Correct-Horse-Battery-927!"

type Any = { query(sql: string, params?: unknown[]): Promise<[unknown, unknown]> }

function clearBootstrapEnv(): void {
  delete process.env.ADMIN_BOOTSTRAP_USERNAME
  delete process.env.ADMIN_BOOTSTRAP_PASSWORD
  delete process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME
}

beforeAll(async () => {
  pool = await freshMigratedPool()
}, 90_000)

afterEach(() => {
  clearBootstrapEnv()
})

afterAll(async () => {
  await dropScratch()
  await pool.end()
})

describe("bootstrap 管理员", () => {
  it("未 seed（缺 super_admin 角色）时拒绝", async () => {
    const outcome = await runBootstrap(makeDb(pool))
    expect(outcome.status).toBe("refused")
  })

  it("缺密码时拒绝（无默认密码回退）", async () => {
    await runSeedRbac(makeDb(pool))
    process.env.ADMIN_BOOTSTRAP_USERNAME = "testadmin"
    const outcome = await runBootstrap(makeDb(pool))
    expect(outcome.status).toBe("refused")
    expect(await userCount()).toBe(0)
  })

  it("弱口令拒绝", async () => {
    process.env.ADMIN_BOOTSTRAP_USERNAME = "testadmin"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "password123"
    const outcome = await runBootstrap(makeDb(pool))
    expect(outcome.status).toBe("refused")
    expect(await userCount()).toBe(0)
  })

  it("用户名冲突（已有普通用户、无 super_admin）时拒绝且不修改其密码", async () => {
    const db = makeDb(pool)
    await db
      .insert(schema.adminUsers)
      .values({ username: "taken_user", passwordHash: "existing-hash-value", displayName: "Taken" })
    const [existing] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "taken_user"))
    process.env.ADMIN_BOOTSTRAP_USERNAME = "taken_user"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = TEST_PASSWORD
    const outcome = await runBootstrap(db)
    expect(outcome.status).toBe("refused")
    const [after] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "taken_user"))
    expect(after.passwordHash).toBe(existing.passwordHash)
    expect(await userCount()).toBe(1)
  })

  it("合法环境变量创建管理员（Argon2id + must_change_password + super_admin）", async () => {
    process.env.ADMIN_BOOTSTRAP_USERNAME = "testadmin"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = TEST_PASSWORD
    const outcome = await runBootstrap(makeDb(pool))
    expect(outcome.status).toBe("created")
    if (outcome.status !== "created") throw new Error("unreachable")
    expect(outcome.username).toBe("testadmin")
    expect(outcome.mustChangePassword).toBe(true)

    const db = makeDb(pool)
    const [user] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "testadmin"))
    expect(user).toBeDefined()
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true)
    expect(user.mustChangePassword).toBe(true)
    expect(user.status).toBe("active")
    expect(user.deletedAt).toBeNull()
    // 输出对象不含明文密码/hash（BigInt id 序列化前先转字符串）
    const outcomeJson = JSON.stringify(outcome, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    expect(outcomeJson).not.toContain(TEST_PASSWORD)
    expect(outcomeJson).not.toContain(user.passwordHash)
    // 角色关联
    const links = await db
      .select({ code: schema.adminRoles.code })
      .from(schema.adminUserRoles)
      .innerJoin(schema.adminRoles, eq(schema.adminUserRoles.roleId, schema.adminRoles.id))
      .where(eq(schema.adminUserRoles.userId, user.id))
    expect(links.map((l) => l.code)).toEqual(["super_admin"])
    expect(await userCount()).toBe(2) // taken_user + testadmin
  })

  it("重复执行 = 安全 no-op（不重置密码、不新增用户）", async () => {
    const db = makeDb(pool)
    const [before] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "testadmin"))
    process.env.ADMIN_BOOTSTRAP_USERNAME = "testadmin"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = TEST_PASSWORD
    const outcome = await runBootstrap(db)
    expect(outcome.status).toBe("already_bootstrapped")
    const [after] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "testadmin"))
    expect(after.passwordHash).toBe(before.passwordHash) // 密码未被重置
    expect(await userCount()).toBe(2)
  })

  it("已有 super_admin 时重复指定任意用户名 = 安全 no-op（不触碰其他用户）", async () => {
    const db = makeDb(pool)
    const [before] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.username, "taken_user"))
    process.env.ADMIN_BOOTSTRAP_USERNAME = "taken_user"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = TEST_PASSWORD
    const outcome = await runBootstrap(db)
    // bootstrap 的语义：已存在 active super_admin → 整体 no-op，优先于冲突检查
    expect(outcome.status).toBe("already_bootstrapped")
    const [after] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.username, "taken_user"))
    expect(after.passwordHash).toBe(before.passwordHash)
    expect(await userCount()).toBe(2)
  })
})

async function userCount(): Promise<number> {
  const [rows] = await (pool as Any).query("SELECT COUNT(*) AS n FROM admin_users")
  return Number((rows as Array<Record<string, unknown>>)[0].n)
}
