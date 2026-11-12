// P6D：广告管理 API DTO（对外合同）
// ─────────────────────────────────────────────────────────────────
// - id 十进制字符串（BIGINT 合同）；DATETIME(3) 以 DB 墙钟字符串透传（P6C 约定）
// - status = 数据库枚举（draft/active/disabled/expired）；effectiveStatus = 根据
//   startsAt/endsAt/当前时间计算的有效状态（仅展示/判断，绝不回写 DB，§5.3）
export type AdDbStatus = "draft" | "active" | "disabled" | "expired"
export type AdEffectiveStatus = "draft" | "scheduled" | "active" | "expired" | "disabled"

export interface AdDto {
  id: string
  position: string
  title: string
  targetUrl: string
  imagePath: string
  status: AdDbStatus
  effectiveStatus: AdEffectiveStatus
  sortOrder: number
  version: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * effectiveStatus 纯函数（§5.3）：
 * - draft → draft；disabled → disabled；expired → expired
 * - active：now < startsAt → scheduled；startsAt 为空视为已开始
 * - 任意非 draft 状态：endsAt 非空且 now >= endsAt → expired（ends_at > NOW 口径）
 * now 采用与 DB 会话一致的本地墙钟字符串（池 timezone:"Z"，naive DATETIME 直写直读）。
 */
export function computeEffectiveStatus(
  status: AdDbStatus,
  startsAt: string | null,
  endsAt: string | null,
  now: string,
): AdEffectiveStatus {
  if (status === "draft") return "draft"
  if (status === "disabled") return "disabled"
  if (endsAt !== null && endsAt <= now) return "expired"
  if (status === "expired") return "expired"
  // status === "active"
  if (startsAt !== null && now < startsAt) return "scheduled"
  return "active"
}
