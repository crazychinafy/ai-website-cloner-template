// P3：管理员服务端 Session（安全文档 §2.2）
// - token = crypto.randomBytes(32) → base64url（43 字符高强度随机串）
// - 数据库只存 SHA-256(token) 摘要（token_hash CHAR(64)）；原始 token 只进 HttpOnly Cookie
// - 验证必须同时满足：未撤销 + 未过期 + 管理员 active + 未软删除（每次请求重新查库，
//   禁用/改密/撤销立即生效，无"cookie 存在 = 已登录"捷径）
// - 时间：与 P2 一致，DATETIME(3) 存 UTC 墙钟字符串 "YYYY-MM-DD HH:MM:SS.mmm"
//   （mysql2 timezone "Z" + drizzle typeCast 返回库内原始字符串，无损往返；
//   同格式定长字符串的字典序 = 时间序，比较一律在 SQL 中完成）
import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm"
import { adminSessions, adminUsers } from "@/lib/db/schema"
import type { AdminDb } from "@/lib/db/client"
import { getDrizzle } from "@/lib/db/client"
import { deriveCsrfToken } from "./csrf.ts"
import { loadUserRolesAndPermissions } from "@/lib/admin/permissions/permissions.ts"

export interface AdminIdentity {
  /** BIGINT 以十进制字符串传输（SKILL 约束） */
  id: string
  username: string
  displayName: string
  mustChangePassword: boolean
  /** 角色 code 列表（每次请求实时加载） */
  roles: string[]
  /** 权限 code 列表（每次请求实时加载，去重排序） */
  permissions: string[]
  /** 由本 Session 派生的 CSRF token（HMAC，可暴露给客户端用于写请求头） */
  csrfToken: string
  /** Session 过期时刻（UTC 墙钟字符串，仅展示/比较，客户端不依赖其做本地运算） */
  expiresAt: string
}

export interface SessionCreated {
  /** 原始 token —— 只允许进入 HttpOnly Cookie，禁止写入响应正文/日志/前端存储 */
  token: string
  tokenHash: string
  expiresAt: string
  maxAgeSec: number
}

// ── 时间工具（UTC 墙钟字符串）───────────────────────────────────────
const pad = (n: number, w = 2) => String(n).padStart(w, "0")

/** 当前 UTC 时刻 → "YYYY-MM-DD HH:MM:SS.mmm"（与池 timezone "Z" 一致） */
export function utcNowString(): string {
  const d = new Date()
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  )
}

/** 对墙钟字符串做整秒偏移（正负均可；毫秒位保留） */
export function addSecondsString(s: string, seconds: number): string {
  const d = parseUtcString(s)
  const t = Math.floor(d.getTime() / 1000) + Math.trunc(seconds)
  return utcFromEpoch(t)
}

function utcFromEpoch(epochSec: number): string {
  const d = new Date(epochSec * 1000)
  const ms = d.getUTCMilliseconds()
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(ms, 3)}`
  )
}

/**
 * 解析 "YYYY-MM-DD HH:MM:SS[.mmm]" 为 UTC Date。
 * 不用 Date.parse：各引擎对空格分隔的解释不一致（可能当本地时区），必须显式按 UTC 处理。
 * 小数秒 1-3 位统一右补齐为毫秒（"7"→700ms、"12"→120ms、"123"→123ms）。
 */
export function parseUtcString(s: string): Date {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/)
  if (!m) throw new Error(`invalid admin datetime string: ${s.slice(0, 40)}`)
  const [, y, mo, da, h, mi, se, f] = m
  const ms = f === undefined ? 0 : Number(f.padEnd(3, "0"))
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se), ms))
}

/** 两个墙钟字符串比较（同格式定长 → 字典序即时间序）：a > b ? */
export function isAfter(a: string, b: string): boolean {
  return a > b
}

// ── token / 哈希 ────────────────────────────────────────────────────

/** 高强度随机 Session token（43 字符 base64url） */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url")
}

/** token 的 SHA-256 十六进制摘要（64 字符，与 token_hash CHAR(64) 对应） */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Session TTL（小时）：环境变量配置，上限 720（env schema 已限制，这里双保险） */
export function sessionTtlHours(): number {
  const h = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12)
  if (!Number.isFinite(h) || h <= 0) return 12
  return Math.min(h, 720)
}

// ── 客户端 IP ───────────────────────────────────────────────────────

/**
 * 客户端 IP 获取策略（部署在 Nginx 后必须按其要求配置）：
 *   location / { proxy_pass http://127.0.0.1:3000;
 *                proxy_set_header X-Forwarded-For $remote_addr;  # 覆盖，而非追加
 *                proxy_set_header Host $host; }
 * 应用取 XFF 最左侧（= 被代理正确覆盖后的真实客户端 IP），其次 X-Real-IP，
 * 两者都无则归为 "direct"（直连/未配置代理的本地场景）。
 * 注意：不解析 XFF 链、不信任 X-Forwarded-For 中间值。
 */
export function resolveClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first && first.length <= 64) return first
  }
  const xri = req.headers.get("x-real-ip")
  if (xri) {
    const v = xri.trim()
    if (v && v.length <= 64) return v
  }
  return "direct"
}

/** 文本 IP → 16 字节二进制（MySQL INET6 形态：v4 前 12 字节补零）；非法输入返回 null */
export function ipToBytes(ip: string): Buffer | null {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const parts = v4.slice(1).map(Number)
    if (parts.some((p) => p > 255)) return null
    return Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...parts])
  }
  const v6 = ip.match(
    /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i,
  )
  if (v6) {
    try {
      const full = expandV6(ip)
      const bytes = Buffer.alloc(16)
      for (let i = 0; i < 8; i++) bytes.writeUInt16BE(parseInt(full.slice(i * 4, i * 4 + 4), 16), i * 2)
      return bytes
    } catch {
      return null
    }
  }
  return null
}

/**
 * 写入 varbinary 列的值：drizzle 0.45 将 varbinary 声明为 string 类型，
 * 这里用 MySQL 二进制字面量 X'<hex>' 携带精确字节（hex 来自上面校验过的 IP，无注入面）。
 */
export function ipLiteral(ip: string): SQL | null {
  const bytes = ipToBytes(ip)
  if (!bytes) return null
  return sql`X'${sql.raw(bytes.toString("hex"))}'`
}

/** 展开 IPv6 简写（:: 与省略前导零）为 8 组 4 位十六进制 */
function expandV6(ip: string): string {
  const addr = ip.toLowerCase().replace(/^\[|\]$/, "")
  const sides = addr.split("::")
  if (sides.length > 2) throw new Error("bad v6")
  const groups: string[] = []
  if (sides.length === 2) {
    const [l, r] = sides
    const lg = l ? l.split(":").filter((g) => g !== "") : []
    const rg = r ? r.split(":").filter((g) => g !== "") : []
    if (lg.length + rg.length > 7) throw new Error("bad v6")
    groups.push(...lg, ...Array(8 - lg.length - rg.length).fill("0"), ...rg)
  } else {
    groups.push(...addr.split(":"))
    if (groups.length !== 8) throw new Error("bad v6")
  }
  if (groups.length !== 8) throw new Error("bad v6")
  return groups.map((g) => g.padStart(4, "0")).join("")
}

// ── Session 生命周期 ────────────────────────────────────────────────

const MAX_UA = 500

/**
 * 创建 Session（登录 / 密码轮换后调用）。
 * 同一登录动作总是生成全新随机 token（登录即轮换 → 天然防 Session Fixation）。
 */
export async function createSession(
  userId: bigint,
  meta: { userAgent?: string | null; ip?: string | null },
  db: AdminDb = getDrizzle(),
): Promise<SessionCreated> {
  const token = newSessionToken()
  const tokenHash = hashSessionToken(token)
  const ttl = sessionTtlHours()
  const expiresAt = addSecondsString(utcNowString(), ttl * 3600)
  await db.insert(adminSessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, MAX_UA) : null,
    ipAddress: ipLiteral(meta.ip ?? ""),
  })
  return { token, tokenHash, expiresAt, maxAgeSec: ttl * 3600 }
}

/**
 * 验证 Session（每次受保护请求都必须调用；不得以"cookie 存在"代替）。
 * 返回 null 表示不可用（不存在/已撤销/已过期/管理员被禁用或软删除/数据库异常 fail-closed）。
 */
export async function verifySession(token: string, db: AdminDb = getDrizzle()): Promise<AdminIdentity | null> {
  if (!token || token.length > 256) return null
  const tokenHash = hashSessionToken(token)
  try {
    const now = utcNowString()
    const rows = await db
      .select({
        userId: adminUsers.id,
        username: adminUsers.username,
        displayName: adminUsers.displayName,
        status: adminUsers.status,
        mustChangePassword: adminUsers.mustChangePassword,
        deletedAt: adminUsers.deletedAt,
        tokenHash: adminSessions.tokenHash,
        expiresAt: adminSessions.expiresAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
          isNull(adminUsers.deletedAt),
          eq(adminUsers.status, "active"),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return null
    const { roles, permissions } = await loadUserRolesAndPermissions(row.userId, db)
    return {
      id: String(row.userId),
      username: row.username,
      displayName: row.displayName,
      mustChangePassword: row.mustChangePassword,
      roles,
      permissions,
      csrfToken: deriveCsrfToken(row.tokenHash),
      expiresAt: row.expiresAt,
    }
  } catch (e) {
    // fail-closed：数据库异常按未认证处理；详情只进日志（无 token/密码）
    console.error(`[admin-session] verify failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** 撤销指定 token 的 Session（注销）。幂等。 */
export async function revokeSessionByToken(token: string, db: AdminDb = getDrizzle()): Promise<void> {
  const tokenHash = hashSessionToken(token)
  await db
    .update(adminSessions)
    .set({ revokedAt: utcNowString() })
    .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)))
}

/** 撤销某管理员的全部 Session（禁用 / 改密 / 强制下线）。幂等。 */
export async function revokeAllUserSessions(userId: bigint, db: AdminDb = getDrizzle()): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: utcNowString() })
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)))
}

/** 查询某管理员当前未撤销的 Session 数（测试/审计辅助） */
export async function countActiveSessions(userId: bigint, db: AdminDb = getDrizzle()): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(adminSessions)
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)))
  return Number(rows[0]?.c ?? 0)
}
