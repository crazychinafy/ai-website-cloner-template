// P4：线路 行 → DTO（mysql-repository 用）
import type { SiteLine } from "../../../db/schema/lines.ts"
import type { LineDto } from "../types.ts"
import { bigToStr } from "./category-mapper.ts"

/** site_lines 行 → LineDto（url 原样） */
export function mapLine(row: SiteLine): LineDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    url: row.url,
  }
}
