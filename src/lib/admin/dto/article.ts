// P6C：文章管理 API DTO（对外合同）
// ─────────────────────────────────────────────────────────────────
// - 与 dto/content.ts 同一合同：BIGINT id 十进制字符串；DATETIME(3) UTC 墙钟字符串
// - createdAt / updatedAt / publishedAt 分开透出（发布语义：草稿 publishedAt=null，
//   首发写一次，归档/再发布与编辑都不覆盖）
// - categoryNameSnapshot 为入库快照（前台列表/详情读它；写路径在 Service 同步）
// - viewCount 为 BIGINT 十进制字符串（前端只读展示，永不清零/不编辑）
export type ArticleStatus = "draft" | "published" | "archived"

export interface ArticleDto {
  id: string
  categoryId: string
  /** 分类名快照（写入时从实时分类取） */
  categoryName: string
  title: string
  contentHtml: string
  /**
   * 服务端 Sanitizer 就地净化出的「编辑器安全正文」（整改问题 01）：
   * contentEditable 只接受本字段，杜绝历史未清洗 HTML 直接写入 DOM；
   * contentHtml 仍是库内原文（前台渲染/审计对照用），读取不修改库。
   */
  editorHtml: string
  coverImage: string
  seoTitle: string
  seoKeywords: string
  seoDescription: string
  authorName: string
  authorAvatar: string
  status: ArticleStatus
  /** 浏览量（BIGINT 字符串；只读） */
  viewCount: string
  publishedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** POST /articles/preview 返回：净化后的正文 HTML（不落库，noindex 预览） */
export interface ArticlePreviewDto {
  html: string
  title: string
}

export type { PageResult } from "./content.ts"
export { idToString, pageResult } from "./content.ts"
