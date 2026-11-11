// P6A：文章分类（article_categories）请求 Zod schema —— 独立一级资源，无 parent
import { z } from "zod"
import { iconClassSchema, nameSchema, reorderItemsSchema, sortOrderSchema, statusSchema, versionSchema } from "./content-fields.ts"
import { statusFilterSchema } from "./list-query.ts"

export const articleCategoryNameSchema = nameSchema(120, "分类名称")

export const createArticleCategorySchema = z.object({
  name: articleCategoryNameSchema,
  iconClass: iconClassSchema,
  sortOrder: sortOrderSchema.optional(),
  status: statusSchema.optional(),
})

export const updateArticleCategorySchema = z
  .object({
    name: articleCategoryNameSchema.optional(),
    iconClass: iconClassSchema,
    sortOrder: sortOrderSchema.optional(),
    status: statusSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (v) => v.name !== undefined || v.iconClass !== undefined || v.sortOrder !== undefined || v.status !== undefined,
    { message: "没有需要修改的字段" },
  )

/** 全局排序（无父级作用域） */
export const reorderArticleCategoriesSchema = z.object({
  items: reorderItemsSchema,
})

export const articleCategoryListQuerySchema = z.object({
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

export type CreateArticleCategoryInput = z.infer<typeof createArticleCategorySchema>
export type UpdateArticleCategoryInput = z.infer<typeof updateArticleCategorySchema>
export type ReorderArticleCategoriesInput = z.infer<typeof reorderArticleCategoriesSchema>
export type ArticleCategoryListQuery = z.infer<typeof articleCategoryListQuerySchema>
