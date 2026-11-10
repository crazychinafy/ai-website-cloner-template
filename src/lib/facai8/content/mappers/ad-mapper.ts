// P4：广告 行 → DTO（mysql-repository 用）
import type { Ad } from "../../../db/schema/ads.ts"
import type { AdDto } from "../types.ts"
import { bigToStr } from "./category-mapper.ts"

/** ads 行 → AdDto（targetUrl → linkUrl，与前台 Ad 消费名一致；路径/URL 原样） */
export function mapAd(row: Ad): AdDto {
  return {
    id: bigToStr(row.id) ?? "",
    linkUrl: row.targetUrl,
    imageUrl: row.imagePath,
    title: row.title,
  }
}
