// P4：链接 / 详情 / 备用链接 行 → DTO（mysql-repository 用）
import type { SiteLink, SiteLinkDetail, SiteLinkMirror } from "../../../db/schema/links.ts"
import type { LinkItemDto, LinkDetailDto, LinkMirrorDto } from "../types.ts"
import { canonFromDb } from "../dates.ts"
import { bigToStr } from "./category-mapper.ts"

/** site_links 行 → LinkItemDto（isGone boolean → 0|1；路径/URL 原样保留 —— 展示映射由消费侧 asset() 完成） */
export function mapLink(row: SiteLink): LinkItemDto {
  return {
    id: bigToStr(row.id) ?? "",
    categoryId: bigToStr(row.categoryId) ?? "",
    logoUrl: row.logoPath,
    url: row.url,
    title: row.title,
    description: row.description,
    isGone: row.isGone ? 1 : 0,
    tagId: bigToStr(row.tagId),
  }
}

/**
 * site_link_details 行 → LinkDetailDto。
 * logoUrl 与 categoryName 在 P2 schema 无独立列（源站详情字段的冗余快照）：
 * 导入时已验证 122 条 detail.logoUrl 恒等于 link.logo_path、categoryName 恒等于所属分类名，
 * 故由调用方以链接行 / 分类名传入 —— 不丢失任何源数据，也不重复存储。
 */
export function mapLinkDetail(
  row: SiteLinkDetail,
  ctx: { linkId: string; logoUrl: string; categoryName: string },
): LinkDetailDto {
  return {
    id: ctx.linkId,
    clickCount: bigToStr(row.clickCount) ?? "0",
    likeCount: bigToStr(row.likeCount) ?? "0",
    createdAt: canonFromDb(row.sourceCreatedAt) ?? "",
    updatedAt: canonFromDb(row.sourceUpdatedAt) ?? "",
    annotation: row.annotation,
    previewImage: row.previewImage,
    logoUrl: ctx.logoUrl,
    categoryName: ctx.categoryName,
    detail: row.detailHtml,
  }
}

/** site_link_mirrors 行 → LinkMirrorDto（id 保留源站 17 位 ID；顺序由 repository 按 sort_order 保证） */
export function mapLinkMirror(row: SiteLinkMirror): LinkMirrorDto {
  return {
    id: bigToStr(row.id) ?? "",
    name: row.name,
    url: row.url,
  }
}
