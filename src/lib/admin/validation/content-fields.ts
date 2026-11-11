// P6A：三个内容模块共用的字段级 Zod 构件
import { z } from "zod"
import { bigintIdSchema } from "./list-query.ts"

/** 名称：必填、trim、按库列长限制（分类/文章分类 120，标签 100） */
export function nameSchema(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过 ${max} 个字符`)
}

/**
 * IconFont Class：允许为空；只允许空格分隔的安全 CSS Class token。
 * 兼容源站形态（如 "il7e7595cf1d30 iconfont icon-USDT"）；
 * 禁止 <>&"'/;() 等 HTML/脚本注入字符与 style 属性形态。
 */
export const iconClassSchema = z
  .string()
  .trim()
  .max(255, "图标 Class 不能超过 255 个字符")
  .regex(/^([A-Za-z_][A-Za-z0-9_-]*)([ \t]+[A-Za-z_][A-Za-z0-9_-]*)*$/, "图标 Class 只允许字母、数字、下划线、连字符（空格分隔）")
  .optional()
  .or(z.literal(""))

/** 排序值：非负整数且在 MySQL INT 范围内 */
export const sortOrderSchema = z
  .number()
  .int("排序值必须为整数")
  .min(0, "排序值不能为负数")
  .max(2_147_483_647, "排序值超出允许范围")

export const statusSchema = z.enum(["active", "disabled"])

/** HEX 颜色：#RRGGBB（保存时统一小写） */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "颜色必须是 #RRGGBB 格式的 HEX 值")
  .transform((v) => v.toLowerCase())

/** 乐观锁版本号（所有更新必须提交当前 version，§10.2） */
export const versionSchema = z.number().int().min(1).max(2_147_483_647)

/** 版本请求体（DELETE ?version= / restore { version }） */
export const versionBodySchema = z.object({ version: versionSchema })

/** 状态切换请求体（enable/disable 快捷端点） */
export const statusChangeSchema = z.object({
  status: statusSchema,
  version: versionSchema,
})

/** 批量排序条目（同一排序范围内，id 不得重复；sortOrder 唯一性在 Service 校验） */
export const reorderItemSchema = z.object({
  id: bigintIdSchema,
  sortOrder: sortOrderSchema,
  version: versionSchema,
})

export const reorderItemsSchema = z
  .array(reorderItemSchema)
  .min(1, "排序条目不能为空")
  .max(500, "单次排序条目不能超过 500")
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const [i, item] of items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: "custom", path: [i, "id"], message: "排序条目 ID 重复" })
      }
      seen.add(item.id)
    }
  })
