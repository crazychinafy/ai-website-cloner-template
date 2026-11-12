// P7：审计日志 DTO（BIGINT 一律十进制字符串；before/after 已脱敏）
export interface AuditLogDto {
  id: string
  /** 操作人用户 ID；null = 从未记录或已被删除（actorDeleted 区分） */
  actorUserId: string | null
  /** 操作人用户名；null 且 actorUserId 非空 → 「已删除管理员」 */
  actorUsername: string | null
  /** true = 有操作人 ID 但账号已被删除（行绝不因 JOIN 失败而丢失） */
  actorDeleted: boolean
  action: string
  resourceType: string
  resourceId: string | null
  /** 脱敏后的变更快照（读取时再兜一层，DB 行不改写） */
  before: unknown
  after: unknown
  requestId: string | null
  /** VARBINARY(16) 解码后的 IP 文本；null → 未知 */
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

/** 列表筛选项（服务端 DISTINCT 真实值，供 SearchToolbar 下拉） */
export interface AuditFilterOptionsDto {
  actions: string[]
  resourceTypes: string[]
  actors: { id: string; username: string }[]
}
