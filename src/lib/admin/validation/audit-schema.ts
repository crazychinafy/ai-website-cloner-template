// P7：审计日志列表查询参数（只读；服务端 Zod 校验 + 排序白名单）
// ─────────────────────────────────────────────────────────────────
// - 分页合同与内容列表一致：page 默认 1；pageSize ∈ {20,50,100} 默认 20（§9.4）
// - 排序白名单：createdAt | id（默认 createdAt DESC，次级 id DESC 稳定分页）
// - 日期边界：YYYY-MM-DD → 半开区间 [start 00:00:00, end 23:59:59.999]（服务端拼接，客户端不传时刻）
// - 空串（SearchToolbar「全部」语义）→ undefined
import "server-only"
import { z } from "zod"
import { BIGINT_ID_RE, PAGE_SIZE_VALUES } from "./list-query.ts"

function optStr(max: number, message: string) {
  return z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max, message))
    .optional()
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export const auditListQuerySchema = z
  .object({
    /** 关键词：action / resource_id / request_id / 操作人用户名 LIKE */
    q: optStr(100, "搜索关键词不能超过 100 个字符"),
    actorUserId: optStr(20, "操作人 ID 格式不正确").pipe(
      z.string().regex(BIGINT_ID_RE, "操作人 ID 格式不正确").optional(),
    ),
    action: optStr(100, "操作类型过长"),
    resourceType: optStr(100, "资源类型过长"),
    resourceId: optStr(100, "资源 ID 过长"),
    requestId: optStr(64, "请求 ID 过长"),
    startDate: optStr(10, "开始日期格式应为 YYYY-MM-DD").pipe(
      z.string().regex(dateRe, "开始日期格式应为 YYYY-MM-DD").optional(),
    ),
    endDate: optStr(10, "结束日期格式应为 YYYY-MM-DD").pipe(
      z.string().regex(dateRe, "结束日期格式应为 YYYY-MM-DD").optional(),
    ),
    page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int("pageSize 必须为整数")
      .refine((v) => (PAGE_SIZE_VALUES as readonly number[]).includes(v), {
        message: "pageSize 只允许 20、50、100",
      })
      .default(20),
    sortBy: z.enum(["createdAt", "id"]).default("createdAt"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.startDate > v.endDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "开始日期不能晚于结束日期" })
    }
  })

export type AuditListQuery = z.infer<typeof auditListQuerySchema>
