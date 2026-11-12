// P8-0：site_settings legacy「双重编码」一次性回填（文档化数据修复，非静默 mapper 放宽）。
// 背景：P4 导入器曾对 json 列预 JSON.stringify（驱动再编码一次）→ 落库双重编码；
//       P6D 后台写路径已改为干净 JSON，库里因此存在新旧混合形态。
// 本脚本按 key 期望类型幂等解包（content/mappers/settings-mapper normalizeSettingStoredValue），
// 将 legacy 行重写为干净 JSON；不触 version/updated_at（值语义不变，乐观锁版本不递增）。
// 用法（默认 dry-run，必须显式 --execute 才写库）：
//   DB_USER=... DB_PASSWORD=... DB_NAME=facai8_admin node scripts/admin/fix-settings-encoding.ts --execute
import mysql from "mysql2/promise"
import { normalizeSettingStoredValue } from "../../src/lib/facai8/content/mappers/settings-mapper.ts"
import { SITE_SETTING_KEYS, type SiteSettingKey } from "../../src/lib/facai8/content/types.ts"

const execute = process.argv.includes("--execute")
const creds = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "facai8_admin",
  user: process.env.DB_USER ?? "facai8_app",
  password: process.env.DB_PASSWORD ?? "",
}

const pool = await mysql.createPool({ ...creds, charset: "UTF8MB4_UNICODE_CI", connectionLimit: 2 })
try {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT setting_key, CAST(setting_value AS CHAR) AS raw FROM site_settings ORDER BY setting_key",
  )
  const known = new Set<string>(SITE_SETTING_KEYS as readonly string[])
  let changed = 0
  for (const r of rows) {
    const key = String(r.setting_key)
    if (!known.has(key)) {
      console.log(`  SKIP   ${key} （非内容 key）`)
      continue
    }
    const stored: unknown = JSON.parse(String(r.raw))
    const normalized = normalizeSettingStoredValue(key as SiteSettingKey, stored)
    const beforeText = JSON.stringify(stored) ?? "null"
    const afterText = JSON.stringify(normalized) ?? "null"
    if (beforeText === afterText) {
      console.log(`  ok     ${key}`)
      continue
    }
    changed++
    console.log(`  fix    ${key}: ${beforeText.slice(0, 60)}… → ${afterText.slice(0, 60)}…`)
    if (execute) {
      // 参数以 JSON 文本传入，MySQL 对 json 列解析一次 → 干净 JSON（驱动不再二次编码）
      await pool.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = ?", [afterText, key])
    }
  }
  console.log(`${execute ? "已修复" : "待修复(dry-run)"} ${changed} / ${rows.length} 行 @ ${creds.database}`)
  if (!execute && changed > 0) process.exitCode = 2
} finally {
  await pool.end()
}
