// P3：认证 API 输入校验（Zod；安全文档 §6）
import { z } from "zod"

/** 登录请求：字段严格限定，未知字段拒绝（422） */
export const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, "请输入用户名")
      .max(64, "用户名过长"),
    password: z
      .string()
      .min(1, "请输入密码")
      .max(128, "密码过长"),
  })
  .strict()

export type LoginInput = z.infer<typeof loginSchema>

/** 修改密码请求：新密码策略 12-128 + 两次一致（弱口令在 service 层二次校验） */
export const changePasswordSchema = z
  .object({
    oldPassword: z
      .string()
      .min(1, "请输入当前密码")
      .max(128, "密码过长"),
    newPassword: z
      .string()
      .min(12, "新密码至少 12 位")
      .max(128, "新密码至多 128 位"),
    confirmPassword: z
      .string()
      .min(1, "请再次输入新密码")
      .max(128, "密码过长"),
  })
  .strict()
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
