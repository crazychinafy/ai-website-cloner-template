// P6D §7/§10/§十二 站点设置 API 全链路（scratch 库 facai8_p6d_test，真实 route handler 调用）
// - 首次 GET 幂等补建白名单 6 key（默认值 = 冻结前台 SITE_INFO），绝不覆盖已有行
// - 非白名单历史行（home_popup / recent_links / stats…）不出入 API、不被改动
// - legacy 双重编码 JSON 读取解包；写回永远干净 JSON；ads_random 布尔归一化
// - PATCH items[{key,value,version}]：per-key value 类型分发、逐 key 乐观锁、任一冲突整批回滚
// - updated_by 服务端写入；version+1；同事务 settings.update 审计（before/after 只记真实差量）
// - logo/favicon 统一媒体校验：禁外链（422 字段错误）、文件缺失 422 SETTINGS_MEDIA_MISSING 零审计
// - RBAC：content_admin 无 settings.read/update（GET/PATCH 403）；auditor GET 200 / PATCH 403；CSRF
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SettingKey, SettingsDto } from "../../src/lib/admin/dto/site-setting.ts"
import { SETTING_DEFAULTS } from "../../src/lib/admin/dto/site-setting.ts"
import {
  auditJson,
  auditRows,
  countAudit,
  errBody,
  p6dLogin,
  rawQuery,
  reqFor,
  seedSettingRaw,
  setupP6dEnv,
  teardownP6dEnv,
  type P6dEnv,
  type P6dSession,
} from "./p6d-harness"

const VERSION_CONFLICT_MSG = "该记录已被其他管理员修改，请刷新后重新编辑"
const IMG = "/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; fields?: Record<string, string> }
}
async function body<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>
}

let env: P6dEnv
let su: P6dSession
let auditor: P6dSession
let editor: P6dSession
let cadmin: P6dSession

let route!: { GET: (req: Request) => Promise<Response>; PATCH: (req: Request) => Promise<Response>; PUT: () => Promise<Response> }

const BASE = "/api/admin/v1/settings"

async function getSettings(session: P6dSession = su): Promise<{ res: Response; json: Envelope<SettingsDto> }> {
  const res = await route.GET(reqFor(session, "GET", BASE))
  return { res, json: await body<SettingsDto>(res) }
}

async function patchSettings(items: unknown[], session: P6dSession = su) {
  const res = await route.PATCH(reqFor(session, "PATCH", BASE, { items }))
  return { res, json: await body<SettingsDto>(res) }
}

async function rawSetting(key: string): Promise<{ setting_value: unknown; version: number; updated_by: string | null } | undefined> {
  const rows = await rawQuery<{ setting_value: unknown; version: number; updated_by: string | null }>(
    env.pool,
    "SELECT CAST(setting_value AS CHAR) AS setting_value, version, updated_by FROM site_settings WHERE setting_key = ?",
    [key],
  )
  return rows[0]
}

async function rawSettingText(key: string): Promise<string | undefined> {
  const r = await rawSetting(key)
  return r ? String(r.setting_value) : undefined
}

beforeAll(async () => {
  env = await setupP6dEnv()
  su = await p6dLogin(env, "p6d-su-settings", ["super_admin"])
  auditor = await p6dLogin(env, "p6d-auditor-settings", ["auditor"])
  editor = await p6dLogin(env, "p6d-editor-settings", ["content_editor"])
  cadmin = await p6dLogin(env, "p6d-cadmin-settings", ["content_admin"])
  route = await import("../../src/app/api/admin/v1/settings/route")

  // 预置非白名单历史行（前台静态数据源依赖；API 绝不能读写它们）
  await seedSettingRaw(env.db, "home_popup", JSON.stringify({ title: "历史弹窗" }), 3)
  await seedSettingRaw(env.db, "recent_links", JSON.stringify([1, 2, 3]), 2)
})

afterAll(async () => {
  if (env) await teardownP6dEnv(env)
})

describe("迁移与幂等初始化（GET 前补建，绝不覆盖）", () => {
  it("迁移 0005：site_settings.version 列存在、UNSIGNED NOT NULL 默认 1", async () => {
    const cols = await rawQuery<{ extra: string; data_type: string; column_type: string; column_default: string | null }>(
      env.pool,
      "SELECT EXTRA AS extra, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, COLUMN_DEFAULT AS column_default " +
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_settings' AND COLUMN_NAME = 'version'",
    )
    expect(cols).toHaveLength(1)
    expect(cols[0]!.data_type).toBe("int")
    expect(cols[0]!.column_type).toContain("unsigned")
    expect(cols[0]!.column_default).toBe("1")
  })

  it("首次 GET：补建白名单 6 key（值=SITE_INFO 默认、version=1），响应 {settings:{key:{value,version}}} 形态", async () => {
    const { res, json } = await getSettings()
    expect(res.status).toBe(200)
    const s = json.data!.settings
    expect(Object.keys(s).sort()).toEqual(["ads_random", "footer_text", "site_description", "site_favicon", "site_logo", "site_name"])
    expect(s.site_name.value).toBe(SETTING_DEFAULTS.site_name)
    expect(s.site_description.value).toBe(SETTING_DEFAULTS.site_description)
    expect(s.footer_text.value).toBe(SETTING_DEFAULTS.footer_text)
    expect(s.ads_random.value).toBe(SETTING_DEFAULTS.ads_random)
    expect(s.ads_random.value).toBe(true)
    for (const key of Object.keys(s) as SettingKey[]) expect(s[key].version).toBe(1)
    // 补建确实落库
    const rows = await rawQuery<{ k: string }>(env.pool, "SELECT setting_key AS k FROM site_settings ORDER BY setting_key")
    expect(rows.map((r) => r.k)).toContain("site_name")
  })

  it("init 幂等且不覆盖已有行：seed 自定义值后 GET 仍是自定义值、version 不前进", async () => {
    await seedSettingRaw(env.db, "site_name", "自定义站名（不被 init 覆盖）", 7)
    const { json } = await getSettings()
    expect(json.data!.settings.site_name.value).toBe("自定义站名（不被 init 覆盖）")
    expect(json.data!.settings.site_name.version).toBe(7)
  })

  it("再 GET 不重复插行、version 不变（读写皆幂等）", async () => {
    const before = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM site_settings")
    await getSettings()
    const after = await rawQuery<{ n: number | string }>(env.pool, "SELECT COUNT(*) AS n FROM site_settings")
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n))
    expect((await getSettings()).json.data!.settings.site_name.version).toBe(7)
  })
})

describe("legacy 双重编码与类型归一化", () => {
  it("双重编码遗留（JSON 列里再包一层字符串）→ GET 解一层为纯文本", async () => {
    // 线上 site_name 遗留形态：JSON 文本为 "\"\\\"legacy值\\\"\"" → 读出 JS 字符串 `"legacy值"`（带引号）
    await seedSettingRaw(env.db, "site_description", '"legacy描述（双重编码）"')
    const { json } = await getSettings()
    expect(json.data!.settings.site_description.value).toBe("legacy描述（双重编码）")
  })

  it("ads_random 遗留 \"true\"/\"false\" 字符串 → 布尔；非法值回退默认", async () => {
    await seedSettingRaw(env.db, "ads_random", "false")
    expect((await getSettings()).json.data!.settings.ads_random.value).toBe(false)
    await seedSettingRaw(env.db, "ads_random", '"true"')
    expect((await getSettings()).json.data!.settings.ads_random.value).toBe(true)
    await seedSettingRaw(env.db, "ads_random", "乱值")
    expect((await getSettings()).json.data!.settings.ads_random.value).toBe(SETTING_DEFAULTS.ads_random)
  })

  it("写回永远干净 JSON：PATCH 解包后的值 → 库里 CAST(setting_value) 只有一层 JSON", async () => {
    await seedSettingRaw(env.db, "site_name", '"再编码的名称"') // 先造双重编码
    const v = (await rawSetting("site_name"))!.version
    const { res } = await patchSettings([{ key: "site_name", value: "干净名称", version: v }])
    expect(res.status).toBe(200)
    const stored = (await rawSettingText("site_name"))!
    expect(stored).toBe(JSON.stringify("干净名称")) // 不再是 "\"\\\"...\\\"\"" 形态
    expect(JSON.parse(stored)).toBe("干净名称")
    expect((await getSettings()).json.data!.settings.site_name.value).toBe("干净名称")
  })
})

describe("PATCH 更新（items / 逐 key 乐观锁 / 整批回滚）", () => {
  it("单 key 成功 → 200，version+1，updated_by=当前管理员（服务端写入），GET 反映新值", async () => {
    const v = (await rawSetting("site_name"))!.version
    const { res, json } = await patchSettings([{ key: "site_name", value: "超管改名", version: v }])
    expect(res.status).toBe(200)
    expect(json.data!.settings.site_name.value).toBe("超管改名")
    expect(json.data!.settings.site_name.version).toBe(v + 1)
    const row = await rawSetting("site_name")
    expect(row!.updated_by).toBe(String(su.admin.id))
  })

  it("批量两 key 全成功 → 都生效；审计一条，resource_id=排序 keys 逗号连接，before/after 只记真实差量", async () => {
    const nameV = (await rawSetting("site_name"))!.version
    const footerV = (await rawSetting("footer_text"))!.version
    const { res } = await patchSettings([
      { key: "footer_text", value: "页脚已更新", version: footerV },
      { key: "site_name", value: "超管改名", version: nameV }, // 与原值相同：version 前进但审计无差量
    ])
    expect(res.status).toBe(200)
    expect((await rawSetting("footer_text"))!.version).toBe(footerV + 1)
    expect((await rawSetting("site_name"))!.version).toBe(nameV + 1)
    const rows = await auditRows(env.pool, "settings.update")
    const last = rows[rows.length - 1]!
    expect(last.resource_type).toBe("site_settings")
    expect(last.resource_id).toBe("footer_text,site_name") // key 排序固定锁顺序（§7.4 防死锁）
    const before = auditJson(last.before_json)
    const after = auditJson(last.after_json)
    expect(after).toEqual({ footer_text: "页脚已更新" })
    expect(before).toEqual({ footer_text: SETTING_DEFAULTS.footer_text })
    expect(after).not.toHaveProperty("site_name")
  })

  it("任一 key 版本冲突 → 409 固定文案，整批回滚（先提交的 key 也不落库）", async () => {
    const nameRow = (await rawSetting("site_name"))!
    const footerRow = (await rawSetting("footer_text"))!
    const before = await countAudit(env.pool, "settings.update")
    const { res, json } = await patchSettings([
      { key: "site_name", value: "应该回滚的名字", version: nameRow.version },
      { key: "footer_text", value: "应该回滚的页脚", version: footerRow.version + 42 },
    ])
    expect(res.status).toBe(409)
    expect(json.error!.message).toBe(VERSION_CONFLICT_MSG)
    expect((await rawSetting("site_name"))!.version).toBe(nameRow.version)
    expect(await rawSettingText("site_name")).not.toContain("应该回滚")
    expect(await rawSettingText("footer_text")).not.toContain("应该回滚")
    expect(await countAudit(env.pool, "settings.update")).toBe(before)
  })

  it("非白名单历史行不出入 GET、PATCH 后也不被改动", async () => {
    const homePopup = await rawSettingText("home_popup")
    await patchSettings([{ key: "footer_text", value: "再看看历史行", version: (await rawSetting("footer_text"))!.version }])
    const afterRow = await rawQuery<{ v: string; ver: number }>(
      env.pool,
      "SELECT CAST(setting_value AS CHAR) AS v, version AS ver FROM site_settings WHERE setting_key = 'home_popup'",
    )
    expect(String(afterRow[0]!.v)).toBe(homePopup)
    expect(afterRow[0]!.ver).toBe(3)
    const s = (await getSettings()).json.data!.settings as Record<string, unknown>
    expect(s).not.toHaveProperty("home_popup")
    expect(s).not.toHaveProperty("recent_links")
  })

  it("updated_by / version 客户端不可覆盖（strictObject 拒绝多余字段）", async () => {
    const { res } = await patchSettings([
      { key: "site_name", value: "夹带字段", version: (await rawSetting("site_name"))!.version, updatedBy: "1" },
    ])
    expect(res.status).toBe(422)
  })
})

describe("PATCH 校验（per-key 类型分发 / key 白名单 / 边界）", () => {
  it("未知 key → 422；重复 key → 422；空 items → 422", async () => {
    expect((await patchSettings([{ key: "home_popup", value: "x", version: 1 }])).res.status).toBe(422)
    const v = (await rawSetting("site_name"))!.version
    const dup = await patchSettings([
      { key: "site_name", value: "a", version: v },
      { key: "site_name", value: "b", version: v },
    ])
    expect(dup.res.status).toBe(422)
    expect((await patchSettings([])).res.status).toBe(422)
  })

  it("value 类型随 key 分发：ads_random 只收布尔，site_name 只收非空字符串", async () => {
    const rv = (await rawSetting("ads_random"))!.version
    expect((await patchSettings([{ key: "ads_random", value: "true", version: rv }])).res.status).toBe(422)
    expect((await patchSettings([{ key: "ads_random", value: 1, version: rv }])).res.status).toBe(422)
    const nameV = (await rawSetting("site_name"))!.version
    expect((await patchSettings([{ key: "site_name", value: 42, version: nameV }])).res.status).toBe(422)
    expect((await patchSettings([{ key: "site_name", value: "   ", version: nameV }])).res.status).toBe(422)
  })

  it("ads_random 布尔切换成功（GET 回读布尔）", async () => {
    const rv = (await rawSetting("ads_random"))!.version
    const { res, json } = await patchSettings([{ key: "ads_random", value: false, version: rv }])
    expect(res.status).toBe(200)
    expect(json.data!.settings.ads_random.value).toBe(false)
    expect((await getSettings()).json.data!.settings.ads_random.value).toBe(false)
  })

  it("长度边界：site_name >100、footer_text >500 → 422；边界内 → 200", async () => {
    const nameV = (await rawSetting("site_name"))!.version
    expect((await patchSettings([{ key: "site_name", value: "长".repeat(101), version: nameV }])).res.status).toBe(422)
    expect((await patchSettings([{ key: "site_name", value: "长".repeat(100), version: nameV }])).res.status).toBe(200)
    const fv = (await rawSetting("footer_text"))!.version
    expect((await patchSettings([{ key: "footer_text", value: "长".repeat(501), version: fv }])).res.status).toBe(422)
  })

  it("缺 version → 422（每个 item 都必须带）", async () => {
    expect((await patchSettings([{ key: "site_name", value: "无版本" }])).res.status).toBe(422)
  })
})

describe("logo/favicon 媒体校验（§7.5 统一媒体事实源）", () => {
  it("外部链接 → 422 字段错误（schema 语法层拒绝），零审计", async () => {
    const v = (await rawSetting("site_logo"))!.version
    const before = await countAudit(env.pool, "settings.update")
    const { res, json } = await patchSettings([{ key: "site_logo", value: "https://cdn.example.com/logo.png", version: v }])
    expect(res.status).toBe(422)
    expect(json.error!.fields!.value).toBeTruthy()
    expect(await countAudit(env.pool, "settings.update")).toBe(before)
    expect((await rawSetting("site_logo"))!.version).toBe(v)
  })

  it("站内但文件不存在 → 422 SETTINGS_MEDIA_MISSING，DB 不变，零审计", async () => {
    const v = (await rawSetting("site_favicon"))!.version
    const before = await countAudit(env.pool, "settings.update")
    const { res, json } = await patchSettings([{ key: "site_favicon", value: "/sites/facai8/images/ghost-favicon.png", version: v }])
    expect(res.status).toBe(422)
    expect(json.error!.code).toBe("SETTINGS_MEDIA_MISSING")
    expect(await countAudit(env.pool, "settings.update")).toBe(before)
    expect((await rawSetting("site_favicon"))!.version).toBe(v)
  })

  it("真实站内文件（含历史 /uploads/ basename 映射形态）→ 200 并落库", async () => {
    const lv = (await rawSetting("site_logo"))!.version
    const { res } = await patchSettings([{ key: "site_logo", value: IMG, version: lv }])
    expect(res.status).toBe(200)
    expect((await getSettings()).json.data!.settings.site_logo.value).toBe(IMG)
    const legacy = (await rawSetting("site_favicon"))!.version
    const r2 = await patchSettings([{ key: "site_favicon", value: "/uploads/2026-09-19/22bb856abdab4f4eae80039cee3b3365.png", version: legacy }])
    expect(r2.res.status).toBe(200)
  })
})

describe("认证 / CSRF / RBAC（API 强制，§九）", () => {
  it("未登录 GET 401；缺 CSRF 的 PATCH 403 CSRF_INVALID", async () => {
    expect((await route.GET(reqFor(su, "GET", BASE, undefined, { noAuth: true }))).status).toBe(401)
    const res = await route.PATCH(
      reqFor(su, "PATCH", BASE, { items: [{ key: "footer_text", value: "x", version: 1 }] }, { noCsrf: true }),
    )
    expect(res.status).toBe(403)
    expect((await errBody(res)).error.code).toBe("CSRF_INVALID")
  })

  it("auditor：GET 200（settings.read），PATCH 403 且零审计", async () => {
    expect((await getSettings(auditor)).res.status).toBe(200)
    const before = await countAudit(env.pool, "settings.update")
    const v = (await rawSetting("footer_text"))!.version
    expect((await patchSettings([{ key: "footer_text", value: "审计员改不动", version: v }], auditor)).res.status).toBe(403)
    expect(await countAudit(env.pool, "settings.update")).toBe(before)
  })

  it("content_admin 无 settings.read/update：GET 403、PATCH 403（§九 角色矩阵）", async () => {
    expect((await getSettings(cadmin)).res.status).toBe(403)
    const v = (await rawSetting("footer_text"))!.version
    expect((await patchSettings([{ key: "footer_text", value: "内容管理员改不动", version: v }], cadmin)).res.status).toBe(403)
  })

  it("content_editor 无 settings.read：GET 403（设置属高权限域）", async () => {
    expect((await getSettings(editor)).res.status).toBe(403)
  })

  it("PUT 段导出 → 405", async () => {
    expect((await route.PUT()).status).toBe(405)
  })
})
