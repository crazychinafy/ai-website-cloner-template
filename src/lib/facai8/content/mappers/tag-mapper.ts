// P4：标签 / 线路 行 → DTO（mysql-repository 用）
import type { SiteTag } from "../../../db/schema/tags.ts"
import type { SiteLine } from "../../../db/schema/lines.ts"
import type { TagDto, LineDto } from "../types.ts"
import { bigToStr } from "./category-mapper.ts"

/** site_tags 行 → TagDto（颜色字段原样保留） */
export function mapTag(row: SiteTag): TagDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    icon: row.iconClass,
    color: row.color,
    bgColor: row.bgColor,
  }
}

/** site_lines 行 → LineDto（url 原样） */
export function mapLine(row: SiteLine): LineDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    url: row.url,
  }
}
