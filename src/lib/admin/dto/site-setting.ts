// P6D：站点设置 API DTO（site_settings 白名单 key 的对外合同）
// ─────────────────────────────────────────────────────────────────
// - 仅暴露白名单 6 个 key（§7.2）；库里的 home_popup / recent_links / search_descriptions /
//   stats 等非白名单行绝不读写（前台静态数据源依赖它们）
// - setting_value 是 JSON 列；历史行是「双重编码」遗留形态（JSON 字符串里再包一层 JSON），
//   读取时按 key 归一化解包一层，写回时永远写干净 JSON（Service 负责）
// - version = 逐 key 乐观锁（migration 0005 新增列）
import { SITE_INFO } from "@/lib/facai8/data/site-info"

export const SETTING_KEYS = ["site_name", "site_description", "site_logo", "site_favicon", "footer_text", "ads_random"] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

/** 每个 key 的值类型（Zod per-key schema 与 Service 归一化共用这张表） */
export interface SettingValueMap {
  site_name: string
  site_description: string
  site_logo: string
  site_favicon: string
  footer_text: string
  ads_random: boolean
}

export type SettingEntry = { value: string | boolean; version: number }
export type SettingsDto = { settings: Record<SettingKey, SettingEntry> }

/** 初始化默认值 = 前台冻结的 SITE_INFO（§7.2；init 只补缺失行，绝不覆盖已有值） */
export const SETTING_DEFAULTS: SettingValueMap = {
  site_name: SITE_INFO.siteName,
  site_description: SITE_INFO.siteDescription,
  site_logo: SITE_INFO.siteLogo,
  site_favicon: SITE_INFO.siteFavicon,
  footer_text: SITE_INFO.footerText,
  ads_random: SITE_INFO.adsRandom,
}

/** 哪些 key 是图片路径（logo/favicon 走统一媒体校验，§7.5） */
export const MEDIA_SETTING_KEYS: readonly SettingKey[] = ["site_logo", "site_favicon"]

/**
 * 读取归一化（legacy 双重编码解包，幂等）：
 * - ads_random：boolean 直用；字符串 "true"/"false"（含被解出引号的形态）→ 布尔
 * - 字符串 key：仅当 JSON 列原值是「以引号开头的字符串且能再 parse 成字符串」时才解一层
 *   （即双重编码遗留 `"\"彩搜搜\""` → 彩搜搜）；已是干净 JSON 的原样返回
 */
export function normalizeSettingValue(key: SettingKey, raw: unknown): string | boolean {
  if (key === "ads_random") {
    if (typeof raw === "boolean") return raw
    if (typeof raw === "string") {
      const s = raw.trim().replace(/^"|"$/g, "")
      if (s === "true") return true
      if (s === "false") return false
    }
    return SETTING_DEFAULTS.ads_random
  }
  if (typeof raw !== "string") return String(raw ?? "")
  if (raw.startsWith('"')) {
    try {
      const inner = JSON.parse(raw)
      if (typeof inner === "string") return inner
    } catch {
      /* 非法内层 JSON：保留原样，交给 PATCH 校验 */
    }
  }
  return raw
}
