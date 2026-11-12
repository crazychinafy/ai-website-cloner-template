// P4：站点设置 / 站点页面 / 图标库 行 → DTO（mysql-repository 用）
// P8-0：setting_value 读取归一化与 P6D 后台（admin/dto/site-setting normalizeSettingValue）同一合同：
//   - 干净 JSON 列值（驱动已解析）直用；
//   - legacy「双重编码」遗留（JSON 列里再包一层 JSON 字符串）按 key 期望类型幂等解一层：
//       文本 key：仅当原值是「以引号开头的字符串且能再 parse 成字符串」时解包；
//       结构 key（home_popup/stats/search_descriptions/recent_links）：原值为字符串时 JSON.parse，
//         解不动或解出类型不符 → 抛错（fail-fast，绝不静默掩盖数据缺失）；
//   - 解包幂等：已是干净形态的值再过一遍不变。
import type { SiteSetting, SitePage, IconLibrary } from "../../../db/schema/settings.ts"
import type { MiniLinkDto, SitePageDto, SiteSettingsDto, IconLibraryDto } from "../types.ts"
import { SITE_SETTING_KEYS, type SiteSettingKey } from "../types.ts"
import { bigToStr } from "./category-mapper.ts"
import type { StaticField } from "../../data/site-static.ts"

/** site_pages 行 → SitePageDto */
export function mapSitePage(row: SitePage): SitePageDto {
  return {
    pageKey: row.pageKey as StaticField,
    title: row.title,
    subtitle: row.subtitle,
    html: row.contentHtml,
  }
}

/** icon_libraries 行 → IconLibraryDto（cssPath 原样 —— public/ 资源映射语义不变） */
export function mapIconLibrary(row: IconLibrary): IconLibraryDto {
  return {
    id: bigToStr(row.id) ?? "",
    prefix: row.prefix,
    hash: row.hash,
    cssPath: row.cssPath,
  }
}

/** 结构类 key（值为 JSON 对象/数组）；其余 key 为文本或布尔 */
const STRUCTURED_KEYS: readonly SiteSettingKey[] = ["home_popup", "stats", "search_descriptions", "recent_links"]

/**
 * 按 key 期望类型归一化 setting_value（legacy 双重编码解包，幂等；P6D 合同同构）。
 * 结构 key 解出的值必须是 object/array（recent_links 为数组），否则抛错。
 */
export function normalizeSettingStoredValue(key: SiteSettingKey, raw: unknown): unknown {
  if (key === "ads_random") return raw
  if (STRUCTURED_KEYS.includes(key)) {
    if (typeof raw !== "string") return raw
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new Error(`site_settings invalid JSON string: ${key}`)
    }
    if (parsed === null || typeof parsed !== "object") throw new Error(`site_settings wrong JSON type: ${key}`)
    if (key === "recent_links" && !Array.isArray(parsed)) throw new Error(`site_settings wrong JSON type: ${key}`)
    if (key !== "recent_links" && Array.isArray(parsed)) throw new Error(`site_settings wrong JSON type: ${key}`)
    return parsed
  }
  // 文本 key：仅解「JSON 字符串里再包一层带引号字符串」的 legacy 形态
  if (typeof raw === "string" && raw.startsWith('"')) {
    try {
      const inner = JSON.parse(raw) as unknown
      if (typeof inner === "string") return inner
    } catch {
      /* 非法内层 JSON：保留原样（与 P6D 归一化一致，交给 DTO 收窄/比对暴露） */
    }
  }
  return raw
}

/**
 * site_settings 键值行 → SiteSettingsDto。
 * setting_value 为 JSON（导入按 §4「JSON 配置保留原始嵌套结构」写干净 JSON；legacy 双重编码读取归一化）。
 * 任一必需键缺失、JSON 非法或类型不符 → 抛错（fail-fast，绝不以默认值静默掩盖数据缺失）。
 */
export function mapSiteSettings(rows: SiteSetting[]): SiteSettingsDto {
  const byKey = new Map<string, SiteSetting>(rows.map((r) => [r.settingKey, r]))
  const parse = (key: (typeof SITE_SETTING_KEYS)[number]) => {
    const row = byKey.get(key)
    if (!row) throw new Error(`site_settings missing key: ${key}`)
    const raw = row.settingValue
    if (raw === null || raw === undefined) throw new Error(`site_settings null value: ${key}`)
    return normalizeSettingStoredValue(key, raw)
  }
  const required = (v: unknown, key: string) => {
    if (v === null || v === undefined) throw new Error(`site_settings incomplete: ${key}`)
    return v
  }
  const popup = required(parse("home_popup"), "home_popup") as SiteSettingsDto["popup"]
  const stats = required(parse("stats"), "stats") as SiteSettingsDto["stats"]
  const sd = required(parse("search_descriptions"), "search_descriptions") as Record<string, string>
  const recent = required(parse("recent_links"), "recent_links") as MiniLinkDto[]
  return {
    siteName: String(required(parse("site_name"), "site_name")),
    siteDescription: String(required(parse("site_description"), "site_description")),
    siteLogo: String(required(parse("site_logo"), "site_logo")),
    siteFavicon: String(required(parse("site_favicon"), "site_favicon")),
    footerText: String(required(parse("footer_text"), "footer_text")),
    adsRandom: Boolean(required(parse("ads_random"), "ads_random")),
    popup: { enabled: Boolean(popup.enabled), title: String(popup.title), content: String(popup.content) },
    stats: {
      links: String(stats.links),
      articles: String(stats.articles),
      comments: String(stats.comments),
      totalViews: String(stats.totalViews),
    },
    searchDescriptions: sd,
    recentLinks: recent.map((m) => ({
      id: String(m.id),
      title: String(m.title),
      logoUrl: String(m.logoUrl),
      url: String(m.url),
      categoryName: String(m.categoryName),
    })),
  }
}
