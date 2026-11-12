// P6D：线路管理请求 Zod schema（site_lines）
// ─────────────────────────────────────────────────────────────────
// 纪律：strictObject 拒绝 id/status/deletedAt 等受保护字段；PATCH 无 status
// （启停走 /status + lines.update，§6.3/§6.4）；url 复用 httpUrlSchema
// （checkHttpUrl 单一事实源：完整 http(s)、禁危险协议 / userinfo / 控制字符）。
import { z } from "zod"
import { httpUrlSchema } from "./link-schema.ts"
import { nameSchema, reorderItemsSchema, sortOrderSchema, statusChangeSchema, versionSchema } from "./content-fields.ts"

/** 线路名称：必填、≤255（§6.2） */
export const lineNameSchema = nameSchema(255, "线路名称")

/** 线路地址：完整 http(s)（列长 2048；协议/userinfo/控制字符策略见 media-path.ts） */
export const lineUrlSchema = httpUrlSchema

/** 启停请求体（statusChangeSchema = active|disabled + version，§6.4） */
export const lineStatusChangeSchema = statusChangeSchema

/** POST：不接受 id/status/version/deletedAt；status 恒 disabled、version 恒 1（Service） */
export const createLineSchema = z.strictObject({
  name: lineNameSchema,
  url: lineUrlSchema,
  sortOrder: sortOrderSchema.optional(),
})

export const updateLineSchema = z
  .strictObject({
    name: lineNameSchema.optional(),
    url: lineUrlSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (v) => v.name !== undefined || v.url !== undefined || v.sortOrder !== undefined,
    { message: "至少提交一个可编辑字段" },
  )

/** 批量排序（§6.5：线路无 position 作用域，全局一个排序范围） */
export const reorderLinesSchema = z.strictObject({
  items: reorderItemsSchema,
})

/** 列表查询（status 只有 active|disabled；与 makeListQuery 同合同，自建保住 sortBy 字面量类型） */
export const lineListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: z.enum(["active", "disabled"]).optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => v === 20 || v === 50 || v === 100, "pageSize 只允许 20、50 或 100")
    .default(20),
  sortBy: z.enum(["sortOrder", "name", "status", "createdAt", "updatedAt", "id"]).default("sortOrder"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type LineListQuery = z.infer<typeof lineListQuerySchema>
export type CreateLineInput = z.infer<typeof createLineSchema>
export type UpdateLineInput = z.infer<typeof updateLineSchema>
export type LineStatusChangeInput = z.infer<typeof lineStatusChangeSchema>
export type ReorderLinesInput = z.infer<typeof reorderLinesSchema>
