// P6A：网址分类（link_categories）请求 Zod schema
// 两级结构约束（§4）：parent_id NULL = 一级；非 NULL 必须指向未删除的一级分类。
import { z } from "zod"
import { bigintIdSchema } from "./list-query.ts"
import {
  iconClassSchema,
  nameSchema,
  reorderItemsSchema,
  sortOrderSchema,
  statusSchema,
  versionSchema,
} from "./content-fields.ts"

export const categoryNameSchema = nameSchema(120, "分类名称")

/** 一级分类：parentId 省略或 null；二级分类：parentId 为 BIGINT 字符串 */
const parentIdSchema = bigintIdSchema.nullable().optional()

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  parentId: parentIdSchema,
  iconClass: iconClassSchema,
  sortOrder: sortOrderSchema.optional(),
  status: statusSchema.optional(),
})

export const updateCategorySchema = z
  .object({
    name: categoryNameSchema.optional(),
    /** 显式传 parentId: null 表示移动为一级分类；不传表示不动父级 */
    parentId: bigintIdSchema.nullable().optional(),
    iconClass: iconClassSchema,
    sortOrder: sortOrderSchema.optional(),
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine((v) => (v.name !== undefined || v.parentId !== undefined || v.iconClass !== undefined || v.sortOrder !== undefined || v.status !== undefined), {
    message: "没有需要修改的字段",
  })

/** 批量排序（§4.4/§10.3）：必须声明排序范围（parentId，null = 一级） */
export const reorderCategoriesSchema = z.object({
  parentId: bigintIdSchema.nullable(),
  items: reorderItemsSchema,
})

/** 列表查询（含 parentId 精确过滤） */
export const categoryListQuerySchema = z
  .object({
    q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
    status: z.enum(["active", "disabled"]).optional(),
    parentId: z
      .union([bigintIdSchema, z.literal("none")])
      .optional(),
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
  .refine((q) => !(q.parentId === "none" && q.includeDeleted), {
    message: "parentId=none 过滤不支持与 includeDeleted 同时使用",
  })

/** 分类树查询（管理页/父级选择器；只回未删除数据，q/status 服务端过滤） */
export const categoryTreeQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: z.enum(["active", "disabled"]).optional(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>
export type CategoryTreeQuery = z.infer<typeof categoryTreeQuerySchema>
