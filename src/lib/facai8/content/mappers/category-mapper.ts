// P4：分类行 → DTO（mysql-repository 用）
import type { LinkCategory, ArticleCategory } from "../../../db/schema/categories.ts"
import type { CatNodeDto, ArticleCategoryDto } from "../types.ts"

/** BIGINT（drizzle mode "bigint"）→ 十进制字符串（BigInt 或驱动回传的字符串均无损） */
export function bigToStr(v: bigint | string | null): string | null {
  if (v === null) return null
  return typeof v === "bigint" ? v.toString() : v
}

/** link_categories 行 → CatNode 单节点（children 由 repository 组装） */
export function mapLinkCategoryNode(row: LinkCategory): CatNodeDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    icon: row.iconClass,
    sortOrder: String(row.sortOrder),
    children: [],
  }
}

/** article_categories 行 → ArticleCategoryDto（sortOrder 保持 string） */
export function mapArticleCategory(row: ArticleCategory): ArticleCategoryDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    icon: row.iconClass,
    sortOrder: String(row.sortOrder),
  }
}
