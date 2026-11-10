// P1：管理后台环境变量（Zod 校验）
// - CONTENT_SOURCE：前台数据源开关，默认 static；仅 P4 导入验证通过后才允许 mysql（SKILL 约束 8）
// - DB_*：MySQL 连接（仅 CONTENT_SOURCE=mysql 或显式脚本调用时生效）
// - ADMIN_*：P2+ 的 session / bootstrap 用
// - 本模块 server-only：禁止 Client Component 导入
import "server-only"
import { z } from "zod"

export const CONTENT_SOURCE_VALUES = ["static", "mysql"] as const
export type ContentSource = (typeof CONTENT_SOURCE_VALUES)[number]

export const adminEnvSchema = z.object({
  /** 前台数据源：static = 读取 src/lib/facai8/data 静态快照（默认）；mysql = 读取数据库 */
  CONTENT_SOURCE: z.enum(CONTENT_SOURCE_VALUES).default("static"),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default("facai8_admin"),
  DB_USER: z.string().min(1).default("facai8_app"),
  /** 密码只允许环境变量注入；空字符串合法（本地无密码开发库） */
  DB_PASSWORD: z.string().default(""),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().positive().max(720).default(12),
  /** P3：CSRF HMAC 密钥。生产必须显式配置（32-256 位随机串）；开发缺省时每进程随机回退 */
  ADMIN_CSRF_SECRET: z.string().min(32).max(256).optional(),
  /** P3：允许的跨站 Origin 白名单（逗号分隔，绝对 http/https URL，禁止 *）；同源恒放行 */
  ADMIN_ALLOWED_ORIGINS: z.string().max(2000).optional(),
  ADMIN_BOOTSTRAP_USERNAME: z.string().min(3).max(64).optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  UPLOAD_DIR: z.string().min(1).default("/data/facai8/uploads"),
})

export type AdminEnv = z.infer<typeof adminEnvSchema>

const ADMIN_ENV_KEYS = [
  "CONTENT_SOURCE",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_POOL_SIZE",
  "ADMIN_SESSION_TTL_HOURS",
  "ADMIN_CSRF_SECRET",
  "ADMIN_ALLOWED_ORIGINS",
  "ADMIN_BOOTSTRAP_USERNAME",
  "ADMIN_BOOTSTRAP_PASSWORD",
  "UPLOAD_DIR",
] as const

/**
 * 解析并校验 process.env（只读取上述白名单键）：
 * - static 模式永不抛错（DB_* 全部有默认值，缺失 = 不使用数据库）
 * - 显式 mysql 模式时任一字段非法 → 抛带字段名的明确错误（fail-fast，
 *   不静默回退 static —— 管理员在 mysql 模式下必须看到真实故障，SKILL §10）
 * - 任何分支都不打印环境值本身（防 DB_PASSWORD 进入日志）
 */
export function getAdminEnv(): AdminEnv {
  const raw: Record<string, unknown> = {}
  for (const key of ADMIN_ENV_KEYS) {
    const v = process.env[key]
    if (v !== undefined && v !== "") raw[key] = v
  }
  const result = adminEnvSchema.safeParse(raw)
  if (result.success) return result.data

  const requested = String(raw.CONTENT_SOURCE ?? "static")
  if (requested === "mysql") {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    throw new Error(`[admin-env] CONTENT_SOURCE=mysql 但环境变量校验失败：${problems}`)
  }
  // static 模式：剔除非法键后按默认值解析（不抛错、不打印值），仅告警键名
  const badKeys = new Set(result.error.issues.map((i) => String(i.path[0] ?? "(root)")))
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!badKeys.has(k)) cleaned[k] = v
  }
  console.warn(`[admin-env] static 模式忽略非法环境变量（未生效）：${[...badKeys].join(", ")}`)
  return adminEnvSchema.parse({ ...cleaned, CONTENT_SOURCE: "static" })
}

/** 当前前台数据源（static | mysql） */
export function getContentSource(): ContentSource {
  return getAdminEnv().CONTENT_SOURCE
}
