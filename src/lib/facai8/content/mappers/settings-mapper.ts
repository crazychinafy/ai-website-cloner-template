// P4：站点设置 / 站点页面 / 图标库 行 → DTO（mysql-repository 用）
import type { SiteSetting, SitePage, IconLibrary } from "../../../db/schema/settings.ts"
import type { MiniLinkDto, SitePageDto, SiteSettingsDto, IconLibraryDto } from "../types.ts"
import { SITE_SETTING_KEYS } from "../types.ts"
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

/**
 * site_settings 键值行 → SiteSettingsDto。
 * setting_value 为 JSON（导入时按 §4「JSON 配置保留原始嵌套结构」写入）；
 * 任一必需键缺失或 JSON 非法 → 抛错（fail-fast，绝不以默认值静默掩盖数据缺失）。
 */
export function mapSiteSettings(rows: SiteSetting[]): SiteSettingsDto {
  const byKey = new Map<string, SiteSetting>(rows.map((r) => [r.settingKey, r]))
  const parse = (key: (typeof SITE_SETTING_KEYS)[number]) => {
    const row = byKey.get(key)
    if (!row) throw new Error(`site_settings missing key: ${key}`)
    const raw = row.settingValue
    if (raw === null || raw === undefined) throw new Error(`site_settings null value: ${key}`)
    if (typeof raw === "string") return JSON.parse(raw) as unknown
    return raw
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
