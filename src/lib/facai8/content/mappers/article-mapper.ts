// P4：文章行 → DTO（mysql-repository 用）
import type { Article } from "../../../db/schema/articles.ts"
import type { ArticleDto, MiniArticleDto } from "../types.ts"
import { canonFromDb } from "../dates.ts"
import { bigToStr } from "./category-mapper.ts"

/**
 * articles 行 → ArticleDto。
 * 日期映射（§4：保留原始创建/更新时间）：
 *   - createdAt := published_at（导入时 = 源 createdAt）
 *   - updatedAt := updated_at（审计列；source_snapshot 行导入时 = 源 updatedAt，
 *     后台编辑后为真实修改时间 —— 两者都是「该行的最新更新时间」语义，无信息丢失）
 */
export function mapArticle(row: Article): ArticleDto {
  return {
    id: bigToStr(row.id) ?? "",
    title: row.title,
    content: row.contentHtml,
    coverImage: row.coverImage,
    categoryId: bigToStr(row.categoryId) ?? "",
    categoryName: row.categoryNameSnapshot,
    seoTitle: row.seoTitle,
    seoKeywords: row.seoKeywords,
    seoDescription: row.seoDescription,
    viewCount: bigToStr(row.viewCount) ?? "0",
    createdAt: canonFromDb(row.publishedAt) ?? canonFromDb(row.createdAt) ?? "",
    updatedAt: canonFromDb(row.updatedAt) ?? "",
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
  }
}

/** 文章行 → 首页右栏 MiniArticleDto */
export function mapMiniArticle(row: Article): MiniArticleDto {
  return {
    id: bigToStr(row.id) ?? "",
    title: row.title,
    categoryName: row.categoryNameSnapshot,
  }
}
