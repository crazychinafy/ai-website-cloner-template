// P6C：公告管理请求 Zod schema（bulletins）
// ─────────────────────────────────────────────────────────────────
// 与 article-schema 同一纪律：strictObject 拒绝受保护字段（status/view 类）、
// PATCH 无 status（走 /status + bulletins.publish）、正文净化在 Service。
// reorder：items[{id, sortOrder, version}]，ID 去重在 reorderItemsSchema，
// 「全部存在且未删除 + 逐行版本」在 Service（任一失败整批回滚）。
import { z } from "zod"
import { articleContentSchema, articleStatusSchema, articleTitleSchema } from "./article-schema.ts"
import { reorderItemsSchema, sortOrderSchema, versionSchema } from "./content-fields.ts"

export const bulletinTitleSchema = articleTitleSchema

/** 公告正文：与文章正文同纪律（长度闸 Zod、净化闸 Service） */
export const bulletinContentSchema = articleContentSchema

export const bulletinStatusSchema = articleStatusSchema

/** POST 恒创建 draft；sortOrder 省略 = 追加到有效行末尾（Service 计算 max+1） */
export const createBulletinSchema = z.strictObject({
  title: bulletinTitleSchema,
  contentHtml: bulletinContentSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
})

export const updateBulletinSchema = z
  .strictObject({
    title: bulletinTitleSchema.optional(),
    contentHtml: bulletinContentSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (v) => v.title !== undefined || v.contentHtml !== undefined || v.sortOrder !== undefined,
    { message: "没有需要修改的字段" },
  )

export const bulletinStatusChangeSchema = z.strictObject({
  status: bulletinStatusSchema,
  version: versionSchema,
})

export const bulletinPreviewSchema = z.strictObject({
  contentHtml: bulletinContentSchema,
  title: bulletinTitleSchema.optional(),
})

/** 批量排序（单事务；任一版本冲突整批回滚） */
export const reorderBulletinsSchema = z.strictObject({
  items: reorderItemsSchema,
})

/** 列表查询：默认排序 sortOrder asc + id desc（置顶语义） */
export const bulletinListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: bulletinStatusSchema.optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => [20, 50, 100].includes(v), { message: "pageSize 只允许 20、50、100" })
    .default(20),
  sortBy: z.enum(["sortOrder", "title", "publishedAt", "createdAt", "updatedAt", "id"]).default("sortOrder"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type BulletinStatus = z.infer<typeof bulletinStatusSchema>
export type BulletinStatusChangeInput = z.infer<typeof bulletinStatusChangeSchema>
export type BulletinPreviewInput = z.infer<typeof bulletinPreviewSchema>
export type CreateBulletinInput = z.infer<typeof createBulletinSchema>
export type UpdateBulletinInput = z.infer<typeof updateBulletinSchema>
export type ReorderBulletinsInput = z.infer<typeof reorderBulletinsSchema>
export type BulletinListQuery = z.infer<typeof bulletinListQuerySchema>
