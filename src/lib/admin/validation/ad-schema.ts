// P6D：广告管理请求 Zod schema（ads）
// ─────────────────────────────────────────────────────────────────
// 纪律与 P6C 一致：strictObject 拒绝 id/status/deletedAt 等受保护字段；
// PATCH 无 status（走 /status + ads.update）；imagePath 的文件存在性在 Service
// （security/media-file.ts，异步），本层只做语法层校验；targetUrl 复用 checkHttpUrl。
import { z } from "zod"
import { checkHttpUrl } from "./media-path.ts"
import { nameSchema, reorderItemsSchema, sortOrderSchema, versionSchema } from "./content-fields.ts"
import { bigintIdSchema } from "./list-query.ts"

/** 广告位置 allowlist（§5.2：P6D 仅开放首页位） */
export const AD_POSITIONS = ["home"] as const
export const adPositionSchema = z.enum(AD_POSITIONS)

/** 数据库状态枚举（列表筛选用；写入路径的 status 一律由服务端状态机决定） */
export const adDbStatusSchema = z.enum(["draft", "active", "disabled", "expired"])

/** /status 允许的目标状态（draft 不是目标：撤回草稿不在 P6D 合同内） */
export const adStatusTargetSchema = z.enum(["active", "disabled", "expired"])

export const adTitleSchema = nameSchema(255, "广告标题")

/** 跳转地址：完整 http(s)（禁危险协议 / userinfo / 控制字符；列长 2048） */
export const adTargetUrlSchema = z
  .string()
  .trim()
  .min(1, "跳转地址不能为空")
  .max(2048, "跳转地址不能超过 2048 个字符")
  .superRefine((v, ctx) => {
    const msg = checkHttpUrl(v, "跳转地址")
    if (msg) ctx.addIssue({ code: "custom", message: msg })
  })

/** 素材路径（语法层；文件存在性在 Service）：站内路径、禁协议相对/外部链接 */
export const adImagePathSchema = z
  .string()
  .trim()
  .min(1, "图片路径不能为空")
  .max(1024, "图片路径不能超过 1024 个字符")
  .refine(
    (v) => v.startsWith("/") && !v.startsWith("//") && !/^https?:/i.test(v),
    "图片路径必须是站内路径（/ 开头，不允许外部链接）",
  )

/**
 * 投放时间：接受 `YYYY-MM-DD HH:mm[:ss]`、`YYYY-MM-DDTHH:mm[:ss]`（可选 .SSS / Z），
 * 归一化为 naive DATETIME(3) 字符串 `YYYY-MM-DD HH:mm:ss.SSS`（与 DB 会话 timezone:"Z" 一致）。
 */
export const adDateTimeSchema = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d{1,6})?Z?$/, "投放时间格式应为 YYYY-MM-DD HH:mm:ss")
  .transform((v) => {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/.exec(v)
    if (!m) return v
    return `${m[1]} ${m[2]}:${m[3] ?? "00"}.000`
  })

const nullableDateTime = adDateTimeSchema.nullable()

/** POST：不接受 id/status/version/deletedAt；status 恒 draft、version 恒 1（Service） */
export const createAdSchema = z.strictObject({
  title: adTitleSchema,
  position: adPositionSchema.default("home"),
  targetUrl: adTargetUrlSchema,
  imagePath: adImagePathSchema,
  sortOrder: sortOrderSchema.optional(),
  startsAt: nullableDateTime.optional(),
  endsAt: nullableDateTime.optional(),
})

export const updateAdSchema = z
  .strictObject({
    title: adTitleSchema.optional(),
    position: adPositionSchema.optional(),
    targetUrl: adTargetUrlSchema.optional(),
    imagePath: adImagePathSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    startsAt: nullableDateTime.optional(),
    endsAt: nullableDateTime.optional(),
    version: versionSchema,
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.position !== undefined ||
      v.targetUrl !== undefined ||
      v.imagePath !== undefined ||
      v.sortOrder !== undefined ||
      v.startsAt !== undefined ||
      v.endsAt !== undefined,
    { message: "至少提交一个可编辑字段" },
  )

export const adStatusChangeSchema = z.object({
  status: adStatusTargetSchema,
  version: versionSchema,
})

/** 批量排序：items + 可选作用域 position（Service 校验全部行同位置，§5.6） */
export const reorderAdsSchema = z.strictObject({
  items: reorderItemsSchema,
  position: adPositionSchema.optional(),
})

/** 列表查询（自建而非 makeListQuery：status 是 4 值枚举、另有 position 过滤） */
export const adListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  position: adPositionSchema.optional(),
  status: adDbStatusSchema.optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => v === 20 || v === 50 || v === 100, "pageSize 只允许 20、50 或 100")
    .default(20),
  sortBy: z.enum(["sortOrder", "title", "status", "startsAt", "endsAt", "createdAt", "updatedAt", "id"]).default("sortOrder"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type AdListQuery = z.infer<typeof adListQuerySchema>
export type CreateAdInput = z.infer<typeof createAdSchema>
export type UpdateAdInput = z.infer<typeof updateAdSchema>
export type AdStatusChangeInput = z.infer<typeof adStatusChangeSchema>
export type ReorderAdsInput = z.infer<typeof reorderAdsSchema>
export { bigintIdSchema }
