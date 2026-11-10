// P4：日期规范化（§11 显式规范化规则）
// 源站存档为无时区 ISO 墙钟 "YYYY-MM-DDTHH:MM:SS"（如 2026-11-07T21:38:04）；
// MySQL DATETIME(3) 存 "YYYY-MM-DD HH:MM:SS.fff"（mysql2 timezone "Z" + drizzle 0.45 field.string() 原样读回，已实测）。
// DTO 统一为「T 分隔、秒精度、原墙钟数字」（不做时区换算 —— 源站即按该墙钟渲染，保留原样是唯一忠实映射）。
// 所有转换函数对格式不匹配输入直接抛错：宁可失败也不静默改写日期。

const SOURCE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/
const DB_WALL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/

export const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** 源站 ISO（可带 1-3 位小数秒）→ 规范形 "YYYY-MM-DDTHH:MM:SS"（截断小数秒 —— 源数据无亚秒语义） */
export function canonFromSource(value: string): string {
  if (!SOURCE_ISO.test(value)) throw new Error(`invalid source date: ${value}`)
  return value.slice(0, 19)
}

/** DB 墙钟字符串（可带 .fff）→ 规范形；null 透传 */
export function canonFromDb(value: string | null): string | null {
  if (value === null) return null
  if (!DB_WALL.test(value)) throw new Error(`invalid db datetime: ${value}`)
  return value.slice(0, 10) + "T" + value.slice(11, 19)
}

/** 规范形 → DB 写入值 "YYYY-MM-DD HH:MM:SS.000"（DATETIME(3) fsp 3 无损） */
export function dbFromCanon(value: string): string {
  if (!CANONICAL_DATE.test(value)) throw new Error(`invalid canonical date: ${value}`)
  return value.slice(0, 10) + " " + value.slice(11) + ".000"
}

/** 两个规范形墙钟字符串比较（同格式定长 → 字典序 = 时间序，供静态侧排序使用） */
export function compareCanon(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** 当前 UTC 墙钟（秒精度，规范形）—— 审计列（created_at/updated_at）取导入时刻用 */
export function utcNowCanon(): string {
  return new Date().toISOString().slice(0, 19)
}
