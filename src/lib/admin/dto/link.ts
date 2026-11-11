// P6B：网址管理 API DTO（对外合同；site_links 聚合）
// ─────────────────────────────────────────────────────────────────
// - 与 dto/content.ts 同一合同：BIGINT id 十进制字符串；DATETIME(3) UTC 墙钟字符串
// - 列表 DTO 附带 categoryName/tagName/clickCount（相关子查询），页面无需二次请求
// - 详情（site_link_details 1:1）可为 null（122/3791 条有详情，缺省行为不变——验收 §P6B）
// - sourceSnapshot/isGone 只读透出（非管理员可编辑；快照语义）
export type LinkStatus = "draft" | "published" | "disabled"

/** 备用链接（site_link_mirrors，1:N；软删除父行时保留） */
export interface LinkMirrorDto {
  id: string
  linkId: string
  name: string
  url: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 详情补充（site_link_details，1:1；click/like 为源站存档计数） */
export interface LinkDetailDto {
  linkId: string
  clickCount: number
  likeCount: number
  annotation: string
  previewImage: string
  detailHtml: string
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  updatedAt: string
}

/** 网址主行（列表与详情共用） */
export interface LinkDto {
  id: string
  categoryId: string
  /** 分类名（相关子查询；分类被删除后仍显示其名称） */
  categoryName: string | null
  tagId: string | null
  tagName: string | null
  title: string
  url: string
  description: string
  logoPath: string
  isGone: boolean
  status: LinkStatus
  sortOrder: number
  sourceSnapshot: boolean
  version: number
  /** 点击数（详情行缺失时 0） */
  clickCount: number
  /** 是否已有详情补充行 */
  hasDetail: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** GET /links/[id] 聚合：主行 + 详情 + 备用链接（软删除行 detail/mirrors 保留） */
export interface LinkAggregateDto extends LinkDto {
  detail: LinkDetailDto | null
  mirrors: LinkMirrorDto[]
}

export type { PageResult } from "./content.ts"
export { idToString, pageResult } from "./content.ts"
