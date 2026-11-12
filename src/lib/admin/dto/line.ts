// P6D：线路管理 API DTO（对外合同）
// ─────────────────────────────────────────────────────────────────
// - id 十进制字符串（BIGINT 合同）；DATETIME(3) 以 DB 墙钟字符串透传（P6C 约定）
// - status 仅 active|disabled（§6.1）；无排期字段、无 effectiveStatus 计算
// - URL 是否可达由前台浏览器侧探测（§6.7）；后台 API 不做任何服务端探测
export type LineStatus = "active" | "disabled"

export interface LineDto {
  id: string
  name: string
  url: string
  status: LineStatus
  sortOrder: number
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
