// P6D：站点设置 Repository（site_settings；setting_key 即业务主键）
// 只按白名单 key 读写；非白名单历史行（home_popup 等）不出入本模块。
import "server-only"
import { asc, inArray, sql } from "drizzle-orm"
import { siteSettings } from "@/lib/db/schema"
import { asExecutor, type AdminTx, type Executor } from "./executor.ts"
import type { SettingKey } from "../dto/site-setting.ts"

export interface SettingRow {
  settingKey: string
  settingValue: unknown
  version: number
}

type Row = typeof siteSettings.$inferSelect

function toRow(r: Row): SettingRow {
  return { settingKey: r.settingKey, settingValue: r.settingValue, version: r.version }
}

/** 按 key 集合读取（无锁；调用方给白名单 key） */
export async function selectSettingRows(exec: Executor, keys: readonly SettingKey[]): Promise<SettingRow[]> {
  const rows = await asExecutor(exec)
    .select()
    .from(siteSettings)
    .where(inArray(siteSettings.settingKey, [...keys]))
    .orderBy(asc(siteSettings.settingKey))
  return rows.map(toRow)
}

/** 事务内按 key 加行锁（调用方保证 keys 已排序——固定锁顺序防死锁） */
export async function lockSettingsForUpdate(tx: AdminTx, keys: readonly SettingKey[]): Promise<SettingRow[]> {
  const rows = await asExecutor(tx)
    .select()
    .from(siteSettings)
    .where(inArray(siteSettings.settingKey, [...keys]))
    .orderBy(asc(siteSettings.settingKey))
    .for("update")
  return rows.map(toRow)
}

/**
 * 幂等初始化：仅插入缺失的 key（默认值由 Service 从 SITE_INFO 提供）。
 * ODKU 空操作 = 已存在的行绝不覆盖（并发首次初始化 race-safe，§7.2）。
 */
export async function insertMissingDefaults(
  tx: AdminTx,
  entries: { key: SettingKey; value: string | boolean }[],
): Promise<void> {
  if (entries.length === 0) return
  await asExecutor(tx)
    .insert(siteSettings)
    .values(entries.map((e) => ({ settingKey: e.key, settingValue: e.value })))
    .onDuplicateKeyUpdate({ set: { settingKey: sql`setting_key` } })
}

/**
 * 乐观锁更新单个 key：写干净 JSON 值、updated_by=当前管理员、version+1。
 * expectedVersion 不匹配 → affectedRows 0（Service 转 409）。
 */
export async function updateSettingWithVersion(
  tx: AdminTx,
  key: SettingKey,
  expectedVersion: number,
  value: string | boolean,
  actorUserId: string,
): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteSettings)
    .set({
      settingValue: value,
      updatedBy: BigInt(actorUserId),
      version: sql`${siteSettings.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(sql`${siteSettings.settingKey} = ${key} AND ${siteSettings.version} = ${expectedVersion}`)) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}
