// P6B：网址管理（site_links 聚合：详情 1:1 + 备用链接 1:N）请求 Zod schema
// ─────────────────────────────────────────────────────────────────
// - URL 服务端校验（任务书 §P6B「URL scheme 校验」）：只允许 http/https，拒绝
//   javascript:/data:/file:/vbscript: 与控制字符；禁账号密码段（SSRF/信息泄漏面收敛）
// - Logo/预览图：受控路径（站内 / 开头）或 http(s) 绝对链接（兼容 1 条历史快照行），
//   不做服务端自动抓取远端 URL（SSRF 禁令，任务书全局约束）
// - 状态机不在 PATCH 中：普通编辑改不了 status（发布/下架/停用必须走 /status 端点，
//   需要 links.publish 权限）；POST 恒为 draft
// - 聚合 PATCH 合同：detail 省略=不改、null=删除详情、对象=upsert；
//   mirrors 省略=不改、数组=全量替换（数组顺序即 sortOrder，服务端重排）
import { z } from "zod"
import { bigintIdSchema } from "./list-query.ts"
import { sortOrderSchema, versionSchema } from "./content-fields.ts"

// ── 状态 ─────────────────────────────────────────────────────────
export const LINK_STATUS_VALUES = ["draft", "published", "disabled"] as const
export const linkStatusSchema = z.enum(LINK_STATUS_VALUES)
export type LinkStatus = (typeof LINK_STATUS_VALUES)[number]

/** 状态切换端点 body（三个状态两两可达除 disabled→draft，见 Service 状态机） */
export const linkStatusChangeSchema = z.object({
  status: linkStatusSchema,
  version: versionSchema,
})

// ── 字段级构件 ───────────────────────────────────────────────────
const CONTROL_RE = /[\u0000-\u0020\u007f]/
const URL_BAD_CHAR_RE = /[<>"'`\\\s]/

/** 校验 URL 结构（调用方保证已 trim/长度）；返回 issue 文案或 null */
export function checkHttpUrl(v: string): string | null {
  if (CONTROL_RE.test(v)) return "地址包含非法控制字符"
  if (URL_BAD_CHAR_RE.test(v)) return "地址包含非法字符"
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return "地址必须是完整的 http(s) 链接"
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "只允许 http / https 协议"
  if (u.username || u.password) return "地址不能包含账号密码"
  const host = u.hostname
  if (!host || host.length > 253) return "地址主机名不合法"
  if (!/^[a-z0-9.\-[\]:]+$/.test(host)) return "地址主机名包含非法字符"
  return null
}

/** 跳转地址：必填完整 http(s) URL（列长 2048） */
export const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "网址地址不能为空")
  .max(2048, "网址地址不能超过 2048 个字符")
  .superRefine((v, ctx) => {
    const msg = checkHttpUrl(v)
    if (msg) ctx.addIssue({ code: "custom", message: msg })
  })

/**
 * Logo / 预览图路径：空串 = 无图；站内根路径（/uploads/...）；
 * http(s) 绝对链接（历史快照存在 1 条绝对 Logo，编辑保存需原样回传）。
 * 拒绝协议相对 //（防协议混淆）、反斜杠与控制字符。
 */
export function mediaPathSchema(label: string, max: number) {
  return z.string().trim().max(max, `${label}不能超过 ${max} 个字符`).superRefine((v, ctx) => {
    if (v === "") return
    if (CONTROL_RE.test(v) || v.includes("\\"))
      ctx.addIssue({ code: "custom", message: `${label}包含非法字符` })
    else if (v.startsWith("//")) ctx.addIssue({ code: "custom", message: `${label}不支持协议相对链接（// 开头）` })
    else if (v.startsWith("/")) return
    else if (!checkHttpUrl(v)) return
    else ctx.addIssue({ code: "custom", message: `${label}必须是站内路径（/ 开头）或 http(s) 链接` })
  })
}

export const logoPathSchema = mediaPathSchema("Logo", 1024)
export const previewImageSchema = mediaPathSchema("预览图", 1024)

export const linkTitleSchema = z
  .string()
  .trim()
  .min(1, "网址名称不能为空")
  .max(255, "网址名称不能超过 255 个字符")

export const linkDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "简介不能超过 2000 个字符")
  .optional()

/** BIGINT UNSIGNED 计数：JS 安全整数范围内（前端 Number 直读） */
const countSchema = z
  .number()
  .int("计数必须为整数")
  .min(0, "计数不能为负数")
  .max(Number.MAX_SAFE_INTEGER, "计数超出允许范围")

/** 详情补充字段（site_link_details；detailHtml 由 Service 做服务端净化） */
export const linkDetailInputSchema = z.object({
  annotation: z.string().trim().max(500, "标注不能超过 500 个字符").optional(),
  previewImage: previewImageSchema.optional(),
  /** 富文本原文；净化后入库。上限 20000 字符（防 64KB 请求体溢出） */
  detailHtml: z.string().max(20_000, "详情正文不能超过 20000 个字符").optional(),
  clickCount: countSchema.optional(),
  likeCount: countSchema.optional(),
})

/** 备用链接条目：id 省略 = 新建；提供 = 更新（Service 校验归属本网址） */
export const linkMirrorInputSchema = z.object({
  id: bigintIdSchema.optional(),
  name: z.string().trim().min(1, "备用链接名称不能为空").max(255, "备用链接名称不能超过 255 个字符"),
  url: httpUrlSchema,
})

export const linkMirrorsSchema = z
  .array(linkMirrorInputSchema)
  .max(20, "备用链接最多 20 条")
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const [i, item] of items.entries()) {
      if (item.id !== undefined) {
        if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "备用链接 ID 重复" })
        seen.add(item.id)
      }
    }
  })

// ── 新建 / 编辑 ──────────────────────────────────────────────────
/** POST 恒创建 draft（status/isGone/sourceSnapshot 不接受客户端输入） */
export const createLinkSchema = z.object({
  title: linkTitleSchema,
  url: httpUrlSchema,
  description: linkDescriptionSchema,
  logoPath: logoPathSchema.optional(),
  categoryId: bigintIdSchema,
  tagId: bigintIdSchema.nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  detail: linkDetailInputSchema.nullable().optional(),
  mirrors: linkMirrorsSchema.optional(),
})

/** PATCH 无 status 字段：状态变更只能走 /status 端点（links.publish 权限） */
export const updateLinkSchema = z
  .object({
    title: linkTitleSchema.optional(),
    url: httpUrlSchema.optional(),
    description: linkDescriptionSchema,
    logoPath: logoPathSchema.optional(),
    categoryId: bigintIdSchema.optional(),
    /** null = 移除标签关联；省略 = 不改 */
    tagId: bigintIdSchema.nullable().optional(),
    sortOrder: sortOrderSchema.optional(),
    /** 省略 = 不改详情；null = 删除详情行；对象 = 部分 upsert */
    detail: linkDetailInputSchema.nullable().optional(),
    /** 省略 = 不改备用链接；数组 = 全量替换（顺序即 sortOrder） */
    mirrors: linkMirrorsSchema.optional(),
    version: versionSchema,
  })
  .superRefine((v, ctx) => {
    const touched =
      v.title !== undefined ||
      v.url !== undefined ||
      v.description !== undefined ||
      v.logoPath !== undefined ||
      v.categoryId !== undefined ||
      v.tagId !== undefined ||
      v.sortOrder !== undefined ||
      v.detail !== undefined ||
      v.mirrors !== undefined
    if (!touched) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "没有需要修改的字段" })
    }
  })

// ── 列表查询 ─────────────────────────────────────────────────────
/** 分页 + q（标题/地址/简介）+ 分类/标签/状态筛选 + 软删除可见性 */
export const linkListQuerySchema = z.object({
  q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
  status: linkStatusSchema.optional(),
  categoryId: bigintIdSchema.optional(),
  tagId: bigintIdSchema.optional(),
  page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize 必须为整数")
    .refine((v) => [20, 50, 100].includes(v), { message: "pageSize 只允许 20、50、100" })
    .default(20),
  sortBy: z.enum(["sortOrder", "title", "createdAt", "updatedAt", "id"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export type LinkStatusChangeInput = z.infer<typeof linkStatusChangeSchema>
export type LinkDetailInput = z.infer<typeof linkDetailInputSchema>
export type LinkMirrorInput = z.infer<typeof linkMirrorInputSchema>
export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>
export type LinkListQuery = z.infer<typeof linkListQuerySchema>
