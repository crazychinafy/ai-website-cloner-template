// P4：公告 行 → DTO（mysql-repository 用）
import type { Bulletin } from "../../../db/schema/bulletins.ts"
import type { BulletinDto } from "../types.ts"
import { canonFromDb } from "../dates.ts"
import { bigToStr } from "./category-mapper.ts"

/** bulletins 行 → BulletinDto（createdAt := published_at，导入时 = 源 createdAt） */
export function mapBulletin(row: Bulletin): BulletinDto {
  return {
    id: bigToStr(row.id) ?? "",
    title: row.title,
    createdAt: canonFromDb(row.publishedAt) ?? "",
    content: row.contentHtml,
  }
}
