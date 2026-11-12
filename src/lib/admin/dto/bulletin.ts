// P6C：公告管理 API DTO（对外合同）
// ─────────────────────────────────────────────────────────────────
// 与文章 DTO 同一合同（字符串 ID / UTC 字符串 / publishedAt 独立语义）；
// sortOrder 为列表排序值（reorder 端点批量维护；新建默认追加到有效行末尾）。
import type { ArticleStatus } from "./article.ts"

export type BulletinStatus = ArticleStatus

export interface BulletinDto {
  id: string
  title: string
  contentHtml: string
  /** 服务端 Sanitizer 就地净化出的编辑器安全正文（整改问题 01，见文章 DTO 同名字段） */
  editorHtml: string
  status: BulletinStatus
  sortOrder: number
  publishedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** POST /bulletins/preview 返回（与文章预览同构） */
export interface BulletinPreviewDto {
  html: string
  title: string
}

export type { PageResult } from "./content.ts"
export { idToString, pageResult } from "./content.ts"
