// P6A：标签（site_tags）请求 Zod schema（§6.2）
import { z } from "zod"
import { hexColorSchema, iconClassSchema, nameSchema, reorderItemsSchema, sortOrderSchema, statusSchema, versionSchema } from "./content-fields.ts"
import { statusFilterSchema } from "./list-query.ts"

export const tagNameSchema = nameSchema(100, "标签名称")

export const createTagSchema = z.object({
  name: tagNameSchema,
  iconClass: iconClassSchema,
  color: hexColorSchema.optional(),
  bgColor: hexColorSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  status: statusSchema.optional(),
})

export const updateTagSchema = z
  .object({
    name: tagNameSchema.optional(),
    iconClass: iconClassSchema,
    color: hexColorSchema.optional(),
    bgColor: hexColorSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.iconClass !== undefined ||
      v.color !== undefined ||
      v.bgColor !== undefined ||
      v.sortOrder !== undefined ||
      v.status !== undefined,
    { message: "没有需要修改的字段" },
  )

/** 标签全局排序（无父级作用域） */
export const reorderTagsSchema = z.object({
  items: reorderItemsSchema,
})

export const tagListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: statusFilterSchema.optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => [20, 50, 100].includes(v), { message: "pageSize 只允许 20、50、100" })
    .default(20),
  sortBy: z.enum(["sortOrder", "name", "id", "createdAt"]).default("sortOrder"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type CreateTagInput = z.infer<typeof createTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
export type ReorderTagsInput = z.infer<typeof reorderTagsSchema>
export type TagListQuery = z.infer<typeof tagListQuerySchema>
