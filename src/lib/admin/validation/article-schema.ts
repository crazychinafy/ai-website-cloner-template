// P6C：文章管理请求 Zod schema（articles）
// ─────────────────────────────────────────────────────────────────
// - create/update 用 strictObject：受保护字段（status/authorName/viewCount/
//   publishedAt/categoryNameSnapshot/deletedAt…）出现在 body → 422 直接拒绝，
//   而不是静默忽略（防止旧前端误传导致「以为改了」）
// - authorName 由服务端取管理员 displayName，categoryNameSnapshot 取实时分类名
// - PATCH 不含 status：发布/归档只能走 /status 端点（articles.publish）
// - contentHtml 只限长度；净化在 Service（sanitizeRichHtml），上限 100,000 字符
//   低于该路由的 512KB body 上限（JSON 转义按 2x 膨胀估算）
import { z } from "zod"
import { bigintIdSchema } from "./list-query.ts"
import { mediaPathSchema } from "./link-schema.ts"
import { versionSchema } from "./content-fields.ts"

/** 标题等纯文本字段禁止控制字符（NUL/换行注入） */
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export const articleStatusSchema = z.enum(["draft", "published", "archived"])

export const articleTitleSchema = z
  .string()
  .trim()
  .min(1, "文章标题不能为空")
  .max(500, "文章标题不能超过 500 个字符")
  .refine((v) => !CONTROL_RE.test(v), "文章标题包含非法控制字符")

/** 正文（LONGTEXT 列）：长度闸在 Zod，净化闸在 Service（富文本 HTML） */
export const articleContentSchema = z
  .string()
  .max(100_000, "正文不能超过 100000 个字符")

export const articleCoverSchema = mediaPathSchema("封面图", 1024)
export const articleAvatarSchema = mediaPathSchema("作者头像", 1024)

const seoTitleSchema = z.string().trim().max(500, "SEO 标题不能超过 500 个字符")
const seoKeywordsSchema = z.string().trim().max(1000, "SEO 关键词不能超过 1000 个字符")
const seoDescriptionSchema = z.string().trim().max(1000, "SEO 描述不能超过 1000 个字符")

// ── 新建 / 编辑 ──────────────────────────────────────────────────
/** POST 恒创建 draft；受保护字段出现即 422（strictObject） */
export const createArticleSchema = z.strictObject({
  title: articleTitleSchema,
  categoryId: bigintIdSchema,
  contentHtml: articleContentSchema.optional(),
  coverImage: articleCoverSchema.optional(),
  seoTitle: seoTitleSchema.optional(),
  seoKeywords: seoKeywordsSchema.optional(),
  seoDescription: seoDescriptionSchema.optional(),
})

/** PATCH：无 status / authorName / viewCount / publishedAt（各自专属通道） */
export const updateArticleSchema = z
  .strictObject({
    title: articleTitleSchema.optional(),
    categoryId: bigintIdSchema.optional(),
    contentHtml: articleContentSchema.optional(),
    coverImage: articleCoverSchema.optional(),
    seoTitle: seoTitleSchema.optional(),
    seoKeywords: seoKeywordsSchema.optional(),
    seoDescription: seoDescriptionSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.categoryId !== undefined ||
      v.contentHtml !== undefined ||
      v.coverImage !== undefined ||
      v.seoTitle !== undefined ||
      v.seoKeywords !== undefined ||
      v.seoDescription !== undefined,
    { message: "没有需要修改的字段" },
  )

/** 状态机请求（published/archived 由 publish 权限驱动；draft 会被状态机拒绝） */
export const articleStatusChangeSchema = z.strictObject({
  status: articleStatusSchema,
  version: versionSchema,
})

/** 预览：不落库；只需正文（标题可选用于预览头） */
export const articlePreviewSchema = z.strictObject({
  contentHtml: articleContentSchema,
  title: articleTitleSchema.optional(),
})

// ── 列表查询 ─────────────────────────────────────────────────────
/** q 命中标题/作者名；categoryId/status 精确；默认排序 updatedAt desc + id desc */
export const articleListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: articleStatusSchema.optional(),
  categoryId: bigintIdSchema.optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => [20, 50, 100].includes(v), { message: "pageSize 只允许 20、50、100" })
    .default(20),
  sortBy: z.enum(["updatedAt", "createdAt", "publishedAt", "viewCount", "title", "id"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type ArticleStatus = z.infer<typeof articleStatusSchema>
export type ArticleStatusChangeInput = z.infer<typeof articleStatusChangeSchema>
export type ArticlePreviewInput = z.infer<typeof articlePreviewSchema>
export type CreateArticleInput = z.infer<typeof createArticleSchema>
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>
