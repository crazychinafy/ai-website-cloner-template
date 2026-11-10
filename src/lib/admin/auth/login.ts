// P3：登录限流与暴力破解防护（安全文档 §5）
// - 基于 admin_login_attempts 表的服务端计数（15 分钟滚动窗口）：
//   同一 用户名+IP ≥ 5 次失败，或 同一 IP（任意用户名）≥ 20 次失败 → 429 + Retry-After
// - 只限"失败"次数；窗口内达到上限后请求直接 429 且不产生新记录（不拖长窗口）
// - 不做永久账号锁定（防恶意锁号 DoS）：Retry-After 只持续到最老的被计数失败滑出窗口
// - 统一错误文案（"用户名或密码错误"）由 service 层给出，限流本身同样不泄露账号是否存在
import "server-only"
import { createHash } from "node:crypto"
import { and, eq, gt, sql } from "drizzle-orm"
import { adminLoginAttempts } from "@/lib/db/schema"
import type { AdminDb } from "@/lib/db/client"
import { getDrizzle } from "@/lib/db/client"
import { addSecondsString, parseUtcString, resolveClientIp, utcNowString } from "./session.ts"

export const RATE_WINDOW_SECONDS = 15 * 60
export const RATE_LIMITS = {
  /** 同一 用户名+IP 组合的失败上限 */
  perUsernameIp: 5,
  /** 同一 IP（所有用户名合计）的失败上限 */
  perIp: 20,
} as const

/** 限流键 = SHA-256 十六进制（64 字符 = CHAR(64)）；原文用户名/IP 不落库 */
export function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

interface BucketCount {
  count: number
  oldest: string | null
}

function bucketQuery(db: AdminDb, windowStart: string, usernameKey: string | null, ipKey: string) {
  return db
    .select({
      count: sql<number>`count(*)`,
      oldest: sql<string | null>`min(${adminLoginAttempts.attemptedAt})`,
    })
    .from(adminLoginAttempts)
    .where(
      and(
        eq(adminLoginAttempts.succeeded, false),
        gt(adminLoginAttempts.attemptedAt, windowStart),
        eq(adminLoginAttempts.ipKey, ipKey),
        ...(usernameKey ? [eq(adminLoginAttempts.usernameKey, usernameKey)] : []),
      ),
    )
    .limit(1)
}

function toBucket(rows: Array<{ count: number | string; oldest: string | null }>): BucketCount {
  const r = rows[0]
  return {
    count: Number(r?.count ?? 0),
    oldest: r?.oldest ?? null,
  }
}

export type RateCheck =
  | { limited: false }
  | { limited: true; retryAfterSec: number; reason: "username" | "ip" }

/**
 * 登录前置限流检查（在任何密码验证之前执行）。
 * 两个维度任一超限即拒绝；Retry-After = 最老被计数失败退出窗口的剩余秒数。
 */
export async function checkRateLimit(username: string, req: Request, db: AdminDb = getDrizzle()): Promise<RateCheck> {
  const ip = resolveClientIp(req)
  const now = utcNowString()
  const windowStart = addSecondsString(now, -RATE_WINDOW_SECONDS)

  const [uBucket, iBucket] = await Promise.all([
    bucketQuery(db, windowStart, hashKey(username.toLowerCase()), hashKey(ip)),
    bucketQuery(db, windowStart, null, hashKey(ip)),
  ])

  const u = toBucket(await uBucket)
  const i = toBucket(await iBucket)

  const explain = (bucket: BucketCount): number | null => {
    if (bucket.oldest === null) return null
    const exitAt = addSecondsString(bucket.oldest, RATE_WINDOW_SECONDS)
    const sec = Math.round((parseEpoch(exitAt) - parseEpoch(now)) / 1000)
    return Math.max(1, sec)
  }

  if (u.count >= RATE_LIMITS.perUsernameIp) {
    return { limited: true, retryAfterSec: explain(u) ?? RATE_WINDOW_SECONDS, reason: "username" }
  }
  if (i.count >= RATE_LIMITS.perIp) {
    return { limited: true, retryAfterSec: explain(i) ?? RATE_WINDOW_SECONDS, reason: "ip" }
  }
  return { limited: false }
}

function parseEpoch(s: string): number {
  return parseUtcString(s).getTime()
}

/** 记录一次登录事件（成功/失败）；失败事件参与限流窗口，成功事件仅留痕 */
export async function recordLoginAttempt(
  username: string,
  req: Request,
  succeeded: boolean,
  db: AdminDb = getDrizzle(),
): Promise<void> {
  await db.insert(adminLoginAttempts).values({
    usernameKey: hashKey(username.toLowerCase()),
    ipKey: hashKey(resolveClientIp(req)),
    attemptedAt: utcNowString(),
    succeeded,
  })
}

/**
 * 清理 24 小时前的历史记录（best-effort：失败不影响登录主流程）。
 * 随每次登录执行并等待（表受 15 分钟限流窗口 + 24h 保留约束，行数小，本地毫秒级）。
 */
export async function cleanupOldAttempts(db: AdminDb = getDrizzle()): Promise<number> {
  const cutoff = addSecondsString(utcNowString(), -24 * 3600)
  const result = (await db
    .delete(adminLoginAttempts)
    .where(sql`${adminLoginAttempts.attemptedAt} < ${cutoff}`)) as unknown as [ResultSetHeaderLike, unknown]
  return Number(result[0]?.affectedRows ?? 0)
}

interface ResultSetHeaderLike {
  affectedRows?: number
}
