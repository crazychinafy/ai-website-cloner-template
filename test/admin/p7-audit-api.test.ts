// P7 测试：审计日志 API（只读；真实 MySQL）
// ─────────────────────────────────────────────────────────────────
// - 权限：401 / 403 FORBIDDEN / auditor 200；POST/PUT/PATCH/DELETE → 405（日志只读）
// - 过滤：q（action/resource_id/request_id/用户名）/actorUserId/action/resourceType/
//         resourceId/requestId/startDate/endDate（含边界）
// - 校验：pageSize 白名单、sortBy 白名单、日期倒挂、BIGINT 格式 → 422 VALIDATION_ERROR
// - 排序：默认 createdAt DESC + 次级 id DESC（同秒稳定分页）；asc 白名单
// - 已删除管理员：悬挂 actor_user_id → actorDeleted=true，行绝不丢失
// - IP：VARBINARY(16)/4 原始字节行 → IPv4 / IPv6 / ::ffff: 映射 / null
// - 脱敏：writeAudit 写入时脱敏落库；直写行在读取时兜底脱敏（DB 行不改写）
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "../../src/lib/db/schema"
import { writeAudit } from "../../src/lib/admin/audit/audit-writer.ts"
import { getAuditFilterOptions } from "../../src/lib/admin/services/audit-service.ts"
import type { AdminTx } from "../../src/lib/admin/repositories/executor.ts"
import type { AuditLogDto, AuditFilterOptionsDto } from "../../src/lib/admin/dto/audit.ts"
import type { PageResult } from "../../src/lib/admin/dto/content.ts"
import { adminReq } from "./test-admin.ts"
import {
  auditRows,
  errBody,
  okBody,
  p7Login,
  parseJsonCol,
  rawQuery,
  reqFor,
  setupP7Env,
  teardownP7Env,
  type P7Session,
  type P7Env,
} from "./p7-harness.ts"

let route: typeof import("../../src/app/api/admin/v1/audit-logs/route.ts")

let env: P7Env
let superS: P7Session
let auditorS: P7Session
let editorS: P7Session

async function list(session: P7Session, qs = ""): Promise<Response> {
  return route.GET(reqFor(session, "GET", `/api/admin/v1/audit-logs${qs ? `?${qs}` : ""}`))
}

async function listData(session: P7Session, qs = ""): Promise<PageResult<AuditLogDto>> {
  const res = await list(session, qs)
  expect(res.status).toBe(200)
  return (await okBody<PageResult<AuditLogDto>>(res)).data
}

const byAct = (d: PageResult<AuditLogDto>, act: string) => d.items.filter((i) => i.action === act)

beforeAll(async () => {
  route = await import("../../src/app/api/admin/v1/audit-logs/route.ts")
  env = await setupP7Env()
  superS = await p7Login(env, "p7-aud-super", ["super_admin"])
  auditorS = await p7Login(env, "p7-aud-auditor", ["auditor"])
  editorS = await p7Login(env, "p7-aud-editor", ["content_admin"])
  const db = env.db

  // 基础业务审计行（应用形态）
  await db.insert(schema.adminAuditLogs).values([
    {
      actorUserId: superS.admin.id,
      action: "link.update",
      resourceType: "link",
      resourceId: "9001",
      beforeJson: { title: "旧" },
      afterJson: { title: "新" },
      requestId: "req-a-001",
      createdAt: "2026-11-01 08:00:00.000",
    },
    {
      actorUserId: auditorS.admin.id,
      action: "tag.create",
      resourceType: "tag",
      resourceId: "77",
      requestId: "req-b-002",
      createdAt: "2026-11-02 09:00:00.000",
    },
    // CLI 行：actor NULL
    {
      actorUserId: null,
      action: "import.execute",
      resourceType: "import_run",
      resourceId: "5",
      requestId: "req-c-003",
      createdAt: "2026-11-03 10:00:00.000",
    },
    // 同秒两条 → 次级 id DESC 决定顺序
    {
      actorUserId: superS.admin.id,
      action: "p7.tie",
      resourceType: "probe",
      resourceId: "tie-a",
      createdAt: "2026-11-02 12:00:00.000",
    },
    {
      actorUserId: superS.admin.id,
      action: "p7.tie",
      resourceType: "probe",
      resourceId: "tie-b",
      createdAt: "2026-11-02 12:00:00.000",
    },
    // 日期边界行（首尾毫秒极值）
    {
      action: "p7.date",
      resourceType: "probe",
      resourceId: "d1",
      createdAt: "2026-11-01 23:59:59.999",
    },
    { action: "p7.date", resourceType: "probe", resourceId: "d2", createdAt: "2026-11-02 00:00:00.000" },
    { action: "p7.date", resourceType: "probe", resourceId: "d3", createdAt: "2026-11-02 23:59:59.999" },
    { action: "p7.date", resourceType: "probe", resourceId: "d4", createdAt: "2026-11-03 00:00:00.000" },
    // 分页组 25 条（同秒，id 递增）
    ...Array.from({ length: 25 }, (_, i) => ({
      action: "p7.bulk",
      resourceType: "probe",
      resourceId: `bulk-${String(i + 1).padStart(2, "0")}`,
      createdAt: "2026-11-01 05:00:00.000",
    })),
    // 直写行（绕过 writeAudit）：未脱敏原值必须被「读取时兜底脱敏」拦截
    {
      action: "p7.secret",
      resourceType: "probe",
      resourceId: "raw1",
      beforeJson: { password: "rawpass-keepme" },
      afterJson: { note: "plain" },
      createdAt: "2026-11-02 23:30:00.000",
    },
  ])

  // 悬挂操作人（FK 是 ON DELETE SET NULL，「已删除管理员」= 账号物理删除前遗留的脏 ID
  // / 跨库导入遗留：关 FK 检查模拟），行必须仍在列表且 actorDeleted=true
  await rawQuery(env.pool, "SET FOREIGN_KEY_CHECKS = 0")
  await rawQuery(
    env.pool,
    `insert into admin_audit_logs (actor_user_id, action, resource_type, resource_id, created_at)
     values (999999999999999999, 'admin.update', 'admin_user', '42', '2026-11-03 11:00:00.000')`,
  )
  await rawQuery(env.pool, "SET FOREIGN_KEY_CHECKS = 1")

  // IP 原始行：直接落 VARBINARY(16)/4 字节（服务器无 INET6ATON，手工构造字节）
  const ipCases: [Buffer, string][] = [
    [Buffer.from([192, 168, 1, 7]), "p7.ip4"], // 4 字节 IPv4
    [
      Buffer.from([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), // 2001:db8::1
      "p7.ip6",
    ],
    [
      Buffer.concat([Buffer.alloc(10), Buffer.from([0xff, 0xff]), Buffer.from([10, 0, 0, 1])]), // ::ffff:10.0.0.1
      "p7.ipmap",
    ],
  ]
  for (const [bytes, act] of ipCases) {
    await rawQuery(
      env.pool,
      `insert into admin_audit_logs (actor_user_id, action, resource_type, resource_id, ip_address, created_at)
       values (NULL, '${act}', 'probe', '1', x'${bytes.toString("hex")}', '2026-11-01 06:00:00.000')`,
    )
  }
  await rawQuery(
    env.pool,
    `insert into admin_audit_logs (actor_user_id, action, resource_type, resource_id, ip_address, created_at)
     values (NULL, 'p7.ipnull', 'probe', '1', NULL, '2026-11-01 06:00:00.000')`,
  )

  // writeAudit 直接调用：写入时机脱敏必须体现在落库行本身
  await db.transaction(async (tx) => {
    await writeAudit(tx as unknown as AdminTx, {
      actorUserId: superS.admin.id.toString(),
      requestId: "req-w-001",
      req: adminReq({ method: "POST", path: "/api/admin/v1/probe" }),
    }, {
      action: "p7.writeaudit",
      resourceType: "probe",
      resourceId: "wa1",
      before: {
        password: "s3cr3t!",
        api_key: "sk-live-abcdef",
        nested: { Authorization: "Bearer xyz.abc", note: "safe" },
        list: [{ x_access_key: "ak-secret-1" }, { safe: 1 }],
      },
      after: { password: "newpass-2", note: "ok" },
    })
  })
}, 120_000)

afterAll(async () => {
  await teardownP7Env(env)
})

describe("审计 API：鉴权与只读合同", () => {
  it("未登录 → 401", async () => {
    const res = await route.GET(reqFor(auditorS, "GET", "/api/admin/v1/audit-logs", undefined, { noAuth: true }))
    expect(res.status).toBe(401)
  })

  it("content_admin 无 audit_logs.read → 403 FORBIDDEN（菜单隐藏 ≠ 授权）", async () => {
    const res = await list(editorS)
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("FORBIDDEN")
  })

  it("auditor → 200，PageResult 形状，id 为十进制字符串", async () => {
    const d = await listData(auditorS, "action=p7.tie")
    expect(d.total).toBe(2)
    expect(d.page).toBe(1)
    expect(d.pageSize).toBe(20)
    expect(d.totalPages).toBe(1)
    expect(d.items[0]!.id).toMatch(/^\d+$/)
  })

  it("POST/PUT/PATCH/DELETE → 405（审计日志无编辑/删除/清理入口）", async () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      // 405 桩函数不读请求，直接调用（reqFor 的 method 类型不含 PUT）
      const call = { POST: route.POST, PUT: route.PUT, PATCH: route.PATCH, DELETE: route.DELETE }[m]
      const r = await call()
      expect(r.status, m).toBe(405)
    }
  })
})

describe("审计 API：过滤", () => {
  it("q 命中 action / resourceId / requestId / 操作人用户名", async () => {
    expect((await listData(superS, "q=req-c-003")).items.map((i) => i.action)).toEqual(["import.execute"])
    const byUser = await listData(superS, `q=${auditorS.admin.username}`)
    expect(byUser.items.map((i) => i.action)).toContain("tag.create")
    expect((await listData(superS, "q=9001")).items.map((i) => i.resourceId)).toEqual(["9001"])
  })

  it("actorUserId / action / resourceType / resourceId / requestId 精确过滤", async () => {
    const actor = await listData(superS, `actorUserId=${auditorS.admin.id}`)
    expect(actor.items.every((i) => i.actorUserId === auditorS.admin.id.toString())).toBe(true)
    expect(actor.items.map((i) => i.action)).toContain("tag.create")

    expect((await listData(superS, "resourceType=import_run")).items.map((i) => i.action)).toEqual(["import.execute"])
    expect((await listData(superS, "resourceId=9001")).items.map((i) => i.action)).toEqual(["link.update"])
    expect((await listData(superS, "requestId=req-a-001")).total).toBe(1)
    const tied = await listData(superS, "action=p7.tie&resourceType=probe")
    expect(tied.total).toBe(2)
  })

  it("日期边界含当天（startDate/endDate 各含端点，毫秒极值不误伤）", async () => {
    const mid = await listData(superS, "action=p7.date&startDate=2026-11-02&endDate=2026-11-02")
    expect(mid.items.map((i) => i.resourceId).sort()).toEqual(["d2", "d3"])
    const from = await listData(superS, "action=p7.date&startDate=2026-11-02")
    expect(from.total).toBe(3) // d2 d3 d4
    const to = await listData(superS, "action=p7.date&endDate=2026-11-02")
    expect(to.total).toBe(3) // d1 d2 d3
  })

  it("分页：25 行 → pageSize 20 两页，第二页 5 行", async () => {
    const p1 = await listData(superS, "action=p7.bulk")
    expect(p1.total).toBe(25)
    expect(p1.items.length).toBe(20)
    expect(p1.totalPages).toBe(2)
    const p2 = await listData(superS, "action=p7.bulk&page=2")
    expect(p2.items.length).toBe(5)
    const ids1 = p1.items.map((i) => i.id)
    const ids2 = p2.items.map((i) => i.id)
    expect(new Set([...ids1, ...ids2]).size).toBe(25) // 无重叠无遗漏
  })
})

describe("审计 API：排序白名单与校验", () => {
  it("默认 createdAt DESC；同秒次级 id DESC；sortBy=id&asc 反转", async () => {
    const d = await listData(superS)
    const times = d.items.map((i) => i.createdAt)
    const sorted = [...times].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    expect(times).toEqual(sorted)
    // createdAt 相同的 tie 组：id 必须严格递减（稳定分页合同）
    const tie = byAct(d, "p7.tie")
    expect(tie.length).toBeGreaterThanOrEqual(2)
    expect(Number(tie[0]!.id) > Number(tie[1]!.id)).toBe(true)
    expect(tie[0]!.resourceId).toBe("tie-b") // 后插入者 id 大 → 排前

    const asc = await listData(superS, "action=p7.date&sortBy=id&sortDir=asc")
    const ascIds = asc.items.map((i) => Number(i.id))
    expect(ascIds).toEqual([...ascIds].sort((a, b) => a - b))
  })

  it("非法参数 → 422 VALIDATION_ERROR（pageSize 白名单 / sortBy 白名单 / 日期倒挂 / ID 格式）", async () => {
    const cases = ["pageSize=30", "sortBy=bogus", "startDate=2026-11-03&endDate=2026-11-01", "actorUserId=abc", "startDate=2026-11-2"]
    for (const qs of cases) {
      const res = await list(superS, qs)
      expect(res.status, qs).toBe(422)
      expect((await errBody(res)).error.code, qs).toBe("VALIDATION_ERROR")
    }
  })
})

describe("审计 API：已删除管理员 / CLI 行 / IP / 脱敏", () => {
  it("悬挂 actor_user_id → actorDeleted=true 且行不丢失；NULL actor 不算已删除", async () => {
    const d = await listData(superS, "action=admin.update")
    expect(d.total).toBe(1)
    const row = d.items[0]!
    expect(row.actorUserId).toBe("999999999999999999")
    expect(row.actorUsername).toBeNull()
    expect(row.actorDeleted).toBe(true)

    const cli = await listData(superS, "action=import.execute")
    expect(cli.items[0]!.actorUserId).toBeNull()
    expect(cli.items[0]!.actorDeleted).toBe(false)
  })

  it("VARBINARY(16)：IPv4 / IPv6 / IPv4-mapped / NULL 全部正确解码", async () => {
    const expectIp = async (act: string, ip: string | null) => {
      const d = await listData(superS, `action=${act}`)
      expect(d.items[0]!.ipAddress).toBe(ip)
    }
    await expectIp("p7.ip4", "192.168.1.7")
    await expectIp("p7.ip6", "2001:db8::1")
    await expectIp("p7.ipmap", "::ffff:10.0.0.1")
    await expectIp("p7.ipnull", null)
  })

  it("writeAudit：敏感值在落库行里就已是 ***（写入时机脱敏）", async () => {
    const raw = await auditRows(env.pool, "where action = 'p7.writeaudit'")
    expect(raw.length).toBe(1)
    const before = JSON.stringify(parseJsonCol(raw[0]!.before_json))
    const after = JSON.stringify(parseJsonCol(raw[0]!.after_json))
    for (const secret of ["s3cr3t!", "sk-live-abcdef", "Bearer xyz.abc", "ak-secret-1", "newpass-2"]) {
      expect(before + after, secret).not.toContain(secret)
    }
    expect(before).toContain("***")
    expect(before).toContain("safe") // 非敏感字段保留
    expect(before).toContain("nested")
  })

  it("读取兜底：直写（未脱敏）历史行在 DTO 里变 ***，DB 行原样不改写", async () => {
    const d = await listData(superS, "action=p7.secret")
    const dto = JSON.stringify(d.items[0]!.before)
    expect(dto).not.toContain("rawpass-keepme")
    expect(dto).toContain("***")

    const raw = await auditRows(env.pool, "where action = 'p7.secret'")
    expect(JSON.stringify(parseJsonCol(raw[0]!.before_json))).toContain("rawpass-keepme") // 只改 DTO，不回写 DB
  })

  it("筛选项：DISTINCT 真实值（actions/resourceTypes/actors）", async () => {
    const opts: AuditFilterOptionsDto = await getAuditFilterOptions(env.db)
    for (const a of ["link.update", "tag.create", "import.execute", "p7.secret"]) expect(opts.actions).toContain(a)
    expect(opts.actions).toEqual([...opts.actions].sort())
    expect(opts.resourceTypes).toContain("import_run")
    expect(opts.actors.find((x) => x.username === superS.admin.username)?.id).toBe(superS.admin.id.toString())
  })
})
