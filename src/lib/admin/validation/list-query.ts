// P6A：列表查询参数（服务端 Zod 校验 + 排序白名单，禁止把 sortBy 直接拼 SQL）
// 分页合同：page 默认 1；pageSize 默认 20，只允许 20/50/100（§9.4）。
import { z } from "zod"
import { ContentError } from "./content-error.ts"

/** 17/18 位 BIGINT 主键：十进制字符串，禁止 Number()/parseInt() */
export const BIGINT_ID_RE = /^[1-9][0-9]{0,19}$/

export const bigintIdSchema = z.string().regex(BIGINT_ID_RE, "ID 格式不正确")

export const PAGE_SIZE_VALUES = [20, 50, 100] as const

/** 状态筛选：active|disabled；软删除可见性走 includeDeleted（§9.1） */
export const statusFilterSchema = z.enum(["active", "disabled"])

/**
 * 生成资源列表查询 schema。
 * sortFields 是服务端 allowlist；不在表内 → 422（绝不透传进 SQL）。
 */
export function makeListQuerySchema<S extends readonly [string, ...string[]]>(opts: {
  sortFields: S
  defaultSortBy: S[number]
}) {
  return z.object({
    q: z.string().trim().max(100, "搜索关键词不能超过 100 个字符").optional(),
    status: statusFilterSchema.optional(),
    page: z.coerce.number().int().min(1, "页码最小为 1").max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int("pageSize 必须为整数")
      .refine((v) => (PAGE_SIZE_VALUES as readonly number[]).includes(v), {
        message: "pageSize 只允许 20、50、100",
      })
      .default(20),
    sortBy: z.enum(opts.sortFields).default(opts.defaultSortBy),
    sortDir: z.enum(["asc", "desc"]).default("asc"),
    includeDeleted: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
}

export type ListQueryInput = z.infer<ReturnType<typeof makeListQuerySchema>>

/** URLSearchParams → 普通对象（重复参数取第一个；空值删除）供 Zod 校验 */
export function searchParamsRecord(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of sp.entries()) {
    if (!(k in out)) out[k] = v
  }
  return out
}

/** 转义 LIKE 通配符（配合 MySQL 默认反斜杠转义） */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** BIGINT 字符串 → bigint（查询参数用；调用方已保证 schema 校验通过） */
export function toBigInt(id: string): bigint {
  return BigInt(id)
}

/** DELETE 的 ?version= 查询参数（乐观锁版本；缺失/非法 → 422） */
export function parseVersionParam(req: Request): number {
  const raw = new URL(req.url).searchParams.get("version")
  const parsed = z.coerce.number().int().min(1, "版本号最小为 1").max(2_147_483_647).safeParse(raw)
  if (!parsed.success) {
    throw new ContentError(422, "VALIDATION_ERROR", "缺少或非法的 version 参数（删除操作必须携带当前版本号）", {
      version: "请携带该记录当前的 version",
    })
  }
  return parsed.data
}
