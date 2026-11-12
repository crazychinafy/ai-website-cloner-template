// P7：导入管理校验（预览/执行/历史查询）
// ─────────────────────────────────────────────────────────────────
// 服务器可信原则：快照版本与 checksum 以服务端计算为准，客户端不能指定或覆盖；
// 执行体里的 snapshotVersion/checksum 只是「预览回执」——与服务端现值不一致 → 409（预览已过期）。
// confirmDatabase 必须等于服务端连接配置里的库名（二次确认：管理员手输，服务层精确比对）。
import "server-only"
import { z } from "zod"
import { PAGE_SIZE_VALUES } from "./list-query.ts"

export const CHECKSUM_RE = /^[0-9a-f]{64}$/

/** 执行请求体（预览回执三元组 + 二次确认；全部 required 防止「盲执行」） */
export const importExecuteBodySchema = z.object({
  /** 预览返回的快照版本（服务端会与实际加载的快照重新比对） */
  snapshotVersion: z.string().trim().min(1, "缺少快照版本").max(100),
  /** 预览返回的快照校验和（64 位小写 hex） */
  checksum: z.string().regex(CHECKSUM_RE, "checksum 必须为 64 位十六进制字符串"),
  /** 二次确认：手动输入的当前数据库名（须与服务端库名一致） */
  confirmDatabase: z.string().trim().min(1, "请输入数据库名进行二次确认").max(100),
  /** 生产环境执行的显式确认（还需 ADMIN_IMPORT_ALLOW_PRODUCTION=1） */
  confirmProduction: z.boolean().optional().default(false),
})
export type ImportExecuteInput = z.infer<typeof importExecuteBodySchema>

function optStr(max: number, message: string) {
  return z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max, message))
    .optional()
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/

/** 历史记录列表查询（admin_import_runs；只读） */
export const importRunListQuerySchema = z
  .object({
    /** 关键词：snapshot_version / checksum LIKE */
    q: optStr(100, "搜索关键词不能超过 100 个字符"),
    mode: optStr(10, "模式不合法").pipe(z.enum(["dry_run", "import"]).optional()),
    status: optStr(10, "状态不合法").pipe(
      z.enum(["pending", "running", "succeeded", "failed", "cancelled"]).optional(),
    ),
    snapshotVersion: optStr(100, "快照版本过长"),
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
    sortBy: z.enum(["startedAt", "id"]).default("startedAt"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.startDate > v.endDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "开始日期不能晚于结束日期" })
    }
  })
export type ImportRunListQuery = z.infer<typeof importRunListQuerySchema>
