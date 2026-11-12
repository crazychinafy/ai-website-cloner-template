// P6D：站点设置请求 Zod schema（§7.4：每个 key 用不同 value schema）
// ─────────────────────────────────────────────────────────────────
// discriminatedUnion(key) 天然实现「按 key 分发 value 校验」；
// logo/favicon 在此只做语法层（站内路径、禁外部链接），文件存在性在 Service
// （security/media-file.ts，与广告 imagePath 同一事实源）。
import { z } from "zod"
import { SETTING_KEYS } from "../dto/site-setting.ts"
import { versionSchema } from "./content-fields.ts"

const keyEnum = z.enum(SETTING_KEYS)

/** 站内图片路径语法层（存在性在 Service）：/ 开头、禁协议相对与 http(s) 外链 */
const mediaPathSchema = z
  .string()
  .trim()
  .min(1, "图片路径不能为空")
  .max(1024, "图片路径不能超过 1024 个字符")
  .refine(
    (v) => v.startsWith("/") && !v.startsWith("//") && !/^https?:/i.test(v),
    "图片必须是站内静态图片路径（/ 开头，不允许外部链接）",
  )

export const siteNameValueSchema = z.string().trim().min(1, "站点名称不能为空").max(100, "站点名称不能超过 100 个字符")
export const siteDescriptionValueSchema = z.string().trim().max(500, "站点描述不能超过 500 个字符")
export const footerTextValueSchema = z.string().trim().max(500, "页脚文字不能超过 500 个字符")

/** 单个设置项（value 类型随 key 分发） */
export const settingItemSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("site_name"), value: siteNameValueSchema, version: versionSchema }),
  z.strictObject({ key: z.literal("site_description"), value: siteDescriptionValueSchema, version: versionSchema }),
  z.strictObject({ key: z.literal("site_logo"), value: mediaPathSchema, version: versionSchema }),
  z.strictObject({ key: z.literal("site_favicon"), value: mediaPathSchema, version: versionSchema }),
  z.strictObject({ key: z.literal("footer_text"), value: footerTextValueSchema, version: versionSchema }),
  z.strictObject({ key: z.literal("ads_random"), value: z.boolean(), version: versionSchema }),
])

/** PATCH /settings 请求体（§7.4 items 形态；key 去重在 schema 层拒绝） */
export const patchSettingsSchema = z
  .strictObject({
    items: z
      .array(settingItemSchema)
      .min(1, "设置项不能为空")
      .max(SETTING_KEYS.length, `单次最多提交 ${SETTING_KEYS.length} 个设置项`)
      .superRefine((items, ctx) => {
        const seen = new Set<string>()
        for (const [i, item] of items.entries()) {
          if (seen.has(item.key)) {
            ctx.addIssue({ code: "custom", path: [i, "key"], message: `设置项 ${item.key} 重复提交` })
          }
          seen.add(item.key)
        }
      }),
  })

export type SettingItemInput = z.infer<typeof settingItemSchema>
export type PatchSettingsInput = z.infer<typeof patchSettingsSchema>

export { keyEnum }
