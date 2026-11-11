// P6A：内容管理 API DTO（对外合同）
// ─────────────────────────────────────────────────────────────────
// - 所有 BIGINT id/parentId 以十进制字符串输出（§9 传输合同，禁止暴露 bigint/number）
// - DATETIME(3) 以 UTC 墙钟字符串输出（schema mode:"string"，与 P2 约定一致）
// - count 字段（linkCount/articleCount/childCount）包含软删除引用（删除保护语义，§5）
export type ContentStatus = "active" | "disabled"

/** 网址分类（link_categories，两级） */
export interface CategoryDto {
  id: string
  parentId: string | null
  name: string
  iconClass: string
  sortOrder: number
  status: ContentStatus
  version: number
  /** 直挂本分类的网址数（含软删除网址） */
  linkCount: number
  /** 子分类数（仅未删除子分类） */
  childCount: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** /categories/tree 的嵌套节点 */
export interface CategoryTreeNodeDto extends CategoryDto {
  children: CategoryTreeNodeDto[]
}

/** 文章分类（article_categories，独立一级资源） */
export interface ArticleCategoryDto {
  id: string
  name: string
  iconClass: string
  sortOrder: number
  status: ContentStatus
  version: number
  /** 挂本分类的文章数（含软删除文章） */
  articleCount: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** 标签（site_tags；注意本表没有 updated_at，以实际 DDL 为准） */
export interface TagDto {
  id: string
  name: string
  iconClass: string
  color: string
  bgColor: string
  sortOrder: number
  status: ContentStatus
  version: number
  /** 使用本标签的网址数（含软删除网址） */
  linkCount: number
  createdAt: string
  deletedAt: string | null
}

/** 分页信封（§9.4：pageSize ∈ {20,50,100}） */
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

/** 写操作统一返回：{ record, deleted? }（软删除回 deletedAt） */
export interface MutationResult<T> {
  record: T
}

/** 小工具：BIGINT → 十进制字符串（null 透传） */
export function idToString(id: bigint | string | null): string | null {
  if (id === null) return null
  return typeof id === "bigint" ? id.toString() : id
}
