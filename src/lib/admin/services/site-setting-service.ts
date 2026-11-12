// P6D：站点设置 Service（site_settings）
// ─────────────────────────────────────────────────────────────────
// 领域规则（§7）：
// - 白名单 6 key；GET 前幂等 init（缺失行按 SITE_INFO 默认值补建，绝不覆盖已有行）
// - 读取归一化 legacy 双重编码（dto/normalizeSettingValue）；写回永远是干净 JSON
// - PATCH：单事务、按 key 排序加行锁、逐 key 版本校验、任一冲突整批回滚（§7.4）
// - updated_by 服务端写入（客户端不可覆盖）；version+1；同事务 settings.update 审计
// - logo/favicon 复用统一媒体校验（security/media-file.ts）：禁外链、文件必须存在
import "server-only"
import { getDrizzle, type AdminDb } from "@/lib/db/client"
import { writeAudit, type WriteCtx } from "../audit/audit-writer.ts"
import { ContentError, versionConflict } from "../validation/content-error.ts"
import { resolveStaticImagePath } from "../security/media-file.ts"
import * as repo from "../repositories/site-setting-repository.ts"
import { asExecutor } from "../repositories/executor.ts"
import {
  MEDIA_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  normalizeSettingValue,
  type SettingEntry,
  type SettingKey,
  type SettingsDto,
} from "../dto/site-setting.ts"
import type { PatchSettingsInput, SettingItemInput } from "../validation/site-setting-schema.ts"

const RT = "site_settings"

function fieldError(field: string, message: string): ContentError {
  return new ContentError(422, "VALIDATION_ERROR", "请求参数不正确", { [field]: message })
}
function keyUnknown(key: string): ContentError {
  return new ContentError(422, "SETTINGS_KEY_UNKNOWN", `设置项 ${key} 不可用`)
}

const MEDIA_LABEL: Partial<Record<SettingKey, string>> = { site_logo: "站点 Logo", site_favicon: "站点 Favicon" }

/** init：缺失的白名单 key 用默认值补建（幂等 + 并发 race-safe，绝不覆盖已有行） */
async function ensureDefaults(executor: Parameters<typeof repo.selectSettingRows>[0]): Promise<void> {
  const existing = await repo.selectSettingRows(executor, SETTING_KEYS)
  const have = new Set(existing.map((r) => r.settingKey))
  const missing = SETTING_KEYS.filter((k) => !have.has(k)).map((k) => ({ key: k, value: SETTING_DEFAULTS[k] }))
  if (missing.length > 0) await repo.insertMissingDefaults(executor as Parameters<typeof repo.insertMissingDefaults>[0], missing)
}

function buildDto(rows: repo.SettingRow[]): SettingsDto {
  const byKey = new Map(rows.map((r) => [r.settingKey, r]))
  const settings = {} as Record<SettingKey, SettingEntry>
  for (const key of SETTING_KEYS) {
    const row = byKey.get(key)
    settings[key] = {
      value: normalizeSettingValue(key, row?.settingValue ?? SETTING_DEFAULTS[key]),
      version: row?.version ?? 1,
    }
  }
  return { settings }
}

// ── GET（含幂等 init）────────────────────────────────────────────

export async function getSettings(db: AdminDb = getDrizzle()): Promise<{ data: SettingsDto }> {
  return db.transaction(async (tx) => {
    await ensureDefaults(asExecutor(tx))
    return { data: buildDto(await repo.selectSettingRows(asExecutor(tx), SETTING_KEYS)) }
  })
}

// ── PATCH（单事务；key 排序固定锁顺序；任一 version 冲突整批回滚）─

export async function updateSettings(
  ctx: WriteCtx,
  input: PatchSettingsInput,
  db: AdminDb = getDrizzle(),
): Promise<{ data: SettingsDto }> {
  const items = input.items
  const unknown = items.find((i) => !(SETTING_KEYS as readonly string[]).includes(i.key))
  if (unknown) throw keyUnknown(unknown.key)

  // 媒体路径存在性（事务外先验，失败 → 422 且零审计；异步 fs 调用不占用行锁）
  for (const [i, item] of items.entries()) {
    if (!(MEDIA_SETTING_KEYS as readonly string[]).includes(item.key)) continue
    const r = await resolveStaticImagePath(String(item.value), MEDIA_LABEL[item.key] ?? "站点图片")
    if (!r.ok) {
      if (r.message.includes("不存在") || r.message.includes("受控静态目录")) {
        throw new ContentError(422, "SETTINGS_MEDIA_MISSING", r.message)
      }
      throw fieldError(`items[${i}].value`, r.message)
    }
  }

  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : 1)) as SettingItemInput[]

  return db.transaction(async (tx) => {
    await ensureDefaults(asExecutor(tx))
    const locked = await repo.lockSettingsForUpdate(
      tx,
      sorted.map((i) => i.key),
    )
    const byKey = new Map(locked.map((r) => [r.settingKey, r]))

    for (const item of sorted) {
      const row = byKey.get(item.key)
      if (!row) throw keyUnknown(item.key)
      if (item.version !== row.version) throw versionConflict()
    }

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const item of sorted) {
      const row = byKey.get(item.key)!
      const ok = await repo.updateSettingWithVersion(tx, item.key, item.version, item.value, ctx.actorUserId)
      if (!ok) throw versionConflict()
      const current = normalizeSettingValue(item.key, row.settingValue)
      if (current !== item.value) {
        before[item.key] = current
        after[item.key] = item.value
      }
    }

    await writeAudit(tx, ctx, {
      action: "settings.update",
      resourceType: RT,
      resourceId: sorted.map((i) => i.key).join(","),
      before,
      after,
    })
    return { data: buildDto(await repo.selectSettingRows(asExecutor(tx), SETTING_KEYS)) }
  })
}
