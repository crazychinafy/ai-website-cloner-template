// P3：管理员认证业务服务（登录 / 注销 / 会话查询 / 修改密码）
// - 唯一被 Route Handler 调用的业务层；DB 访问全部集中于此（+ auth/* 原语）
// - 失败一律抛 AuthError（统一错误码/文案/状态码），由 route 映射为 {success:false} 信封
// - 明文密码 / Session token 绝不进入响应正文与日志（只进 HttpOnly Cookie）
import "server-only"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { adminAuditLogs, adminUsers } from "@/lib/db/schema"
import type { AdminDb } from "@/lib/db/client"
import { getDrizzle } from "@/lib/db/client"
import { err, type AdminErrorCode } from "@/lib/admin/api/response.ts"
import { changePasswordSchema, loginSchema } from "@/lib/admin/validation/auth-schema.ts"
import {
  checkNewPassword,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from "@/lib/admin/auth/password.ts"
import {
  parseAdminToken,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "@/lib/admin/auth/cookies.ts"
import { isWriteOriginAllowed, verifyCsrfToken } from "@/lib/admin/auth/csrf.ts"
import {
  createSession,
  hashSessionToken,
  ipLiteral,
  resolveClientIp,
  revokeAllUserSessions,
  revokeSessionByToken,
  utcNowString,
  verifySession,
} from "@/lib/admin/auth/session.ts"
import { cleanupOldAttempts, checkRateLimit, recordLoginAttempt } from "@/lib/admin/auth/login.ts"

/** drizzle 事务句柄类型（随 AdminDb 推导，测试传入 scratch 实例时同样成立） */
type AdminTx = Parameters<Parameters<AdminDb["transaction"]>[0]>[0]

/** 认证域业务异常（route 层映射为统一错误响应） */
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: AdminErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(message)
  }
}

/** AuthError → 统一错误信封 */
export function authErrorResponse(e: AuthError): Response {
  return err(e.code, e.message, { status: e.status, retryAfter: e.retryAfter, fields: e.fields })
}

const MAX_BODY_BYTES = 64 * 1024

function isJsonContent(req: Request): boolean {
  const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  return ct === "application/json"
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new AuthError(400, "VALIDATION_ERROR", "请求体过大")
  }
  try {
    const obj: unknown = JSON.parse(new TextDecoder().decode(buf))
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      throw new AuthError(400, "VALIDATION_ERROR", "请求格式错误")
    }
    return obj as Record<string, unknown>
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new AuthError(400, "VALIDATION_ERROR", "请求格式错误（JSON 解析失败）")
  }
}

function requireWriteOrigin(req: Request): void {
  if (!isWriteOriginAllowed(req)) {
    throw new AuthError(403, "CSRF_INVALID", "请求来源不受信任")
  }
}

function zodFields(
  e: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> },
): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const i of e.issues) {
    const key = i.path.length > 0 ? String(i.path[i.path.length - 1]) : "body"
    // Zod 内部消息（字段缺失/类型不符，如 "Invalid input: expected string, received undefined"）
    // 不是用户可见文案：统一为中性提示；schema 自定义消息（min/max/refine）原样透出
    const msg = i.code === "invalid_type" ? "参数格式不正确" : i.message
    if (!(key in fields)) fields[key] = msg
  }
  return fields
}

function requireJson(req: Request): void {
  if (!isJsonContent(req)) throw new AuthError(400, "VALIDATION_ERROR", "请求格式错误")
}

// ── 登录 ────────────────────────────────────────────────────────────

export interface LoginResult {
  data: {
    id: string
    username: string
    displayName: string
    mustChangePassword: boolean
  }
  /** Set-Cookie 头值（原始 token 只进 Cookie，绝不进 JSON） */
  setCookie: string
  /** 客户端跳转目标（登录页据此决定去向） */
  redirect: "/admin" | "/admin/change-password"
}

/**
 * 登录（POST /api/admin/v1/auth/login）：
 * Origin 校验 → JSON 校验 → Zod → 限流前置 → Argon2id 验证（账号不存在走哑验证均衡时序）
 * → 状态资格（active 且未软删除）→ 记录事件 → 创建新 Session（登录即轮换，防 Fixation）
 * → 更新 last_login_at。所有失败路径返回统一文案，不泄露账号是否存在。
 */
export async function login(req: Request, db: AdminDb = getDrizzle()): Promise<LoginResult> {
  requireWriteOrigin(req)
  requireJson(req)
  const body = await readJsonBody(req)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    throw new AuthError(422, "VALIDATION_ERROR", "请求参数不正确", zodFields(parsed.error))
  }
  const { username, password } = parsed.data

  const limit = await checkRateLimit(username, req, db)
  if (limit.limited) {
    throw new AuthError(429, "RATE_LIMITED", "尝试次数过多，请稍后再试", undefined, limit.retryAfterSec)
  }

  const rows = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1)
  const user = rows[0]

  // 时序均衡：账号不存在时执行同构 hash 验证，使两类失败耗时一致（防账号枚举）
  let passwordOk = false
  if (user) {
    passwordOk = await verifyPassword(password, user.passwordHash)
  } else {
    await dummyVerify()
  }

  const eligible = Boolean(user && user.status === "active" && user.deletedAt === null && passwordOk)

  await recordLoginAttempt(username, req, eligible, db)

  // 每次登录尝试（成功或失败）后清理 24h 前的历史 —— 必须位于失败抛错之前，
  // 因为失败登录才是产生待清理行的主要来源
  await cleanupOldAttempts(db).catch(() => {
    /* best-effort 清理失败不影响登录 */
  })

  if (!eligible || !user) {
    throw new AuthError(401, "UNAUTHORIZED", "用户名或密码错误")
  }

  const now = utcNowString()
  const session = await createSession(
    user.id,
    {
      userAgent: req.headers.get("user-agent"),
      ip: resolveClientIp(req),
    },
    db,
  )
  await db
    .update(adminUsers)
    .set({ lastLoginAt: now })
    .where(eq(adminUsers.id, user.id))

  return {
    data: {
      id: String(user.id),
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
    },
    setCookie: serializeSessionCookie(session.token, session.maxAgeSec),
    redirect: user.mustChangePassword ? "/admin/change-password" : "/admin",
  }
}

// ── 注销 ────────────────────────────────────────────────────────────

export interface LogoutResult {
  data: { loggedOut: boolean }
  setCookie: string
}

/**
 * 注销（POST /api/admin/v1/auth/logout）：幂等。
 * - 无 token → 直接清 Cookie（200）
 * - Session 有效 → 必须通过 CSRF 校验 → 撤销 DB Session → 清 Cookie（原 token 不得继续使用）
 * - Session 已失效（过期/已撤销）→ 跳过 CSRF → 清 Cookie
 */
export async function logout(req: Request, db: AdminDb = getDrizzle()): Promise<LogoutResult> {
  requireWriteOrigin(req)
  const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (ct !== "" && !isJsonContent(req)) {
    throw new AuthError(400, "VALIDATION_ERROR", "请求格式错误")
  }

  const token = parseAdminToken(req.headers.get("cookie"))
  if (!token) {
    return { data: { loggedOut: false }, setCookie: serializeClearedSessionCookie() }
  }

  const identity = await verifySession(token, db)
  if (identity) {
    const tokenHash = hashSessionToken(token)
    if (!verifyCsrfToken(tokenHash, req.headers.get("x-csrf-token"))) {
      throw new AuthError(403, "CSRF_INVALID", "CSRF 校验失败")
    }
    await revokeSessionByToken(token, db)
    return { data: { loggedOut: true }, setCookie: serializeClearedSessionCookie() }
  }

  // Session 已无效：直接清理 Cookie（无有效 Session 可被跨站利用，不要求 CSRF）
  return { data: { loggedOut: false }, setCookie: serializeClearedSessionCookie() }
}

// ── 会话查询 ────────────────────────────────────────────────────────

export interface SessionResult {
  data: {
    id: string
    username: string
    displayName: string
    roles: string[]
    permissions: string[]
    mustChangePassword: boolean
    csrfToken: string
    expiresAt: string
  }
}

/**
 * 查询当前会话（GET /api/admin/v1/auth/session）：
 * 未登录/失效 → 401。返回角色、权限（实时）、CSRF token；
 * 绝不返回 password_hash、原始 token、DB 凭据等敏感字段。
 */
export async function getSession(req: Request, db: AdminDb = getDrizzle()): Promise<SessionResult> {
  const token = parseAdminToken(req.headers.get("cookie"))
  const identity = token ? await verifySession(token, db) : null
  if (!identity) {
    throw new AuthError(401, "UNAUTHORIZED", "请先登录")
  }
  return {
    data: {
      id: identity.id,
      username: identity.username,
      displayName: identity.displayName,
      roles: identity.roles,
      permissions: identity.permissions,
      mustChangePassword: identity.mustChangePassword,
      csrfToken: identity.csrfToken,
      expiresAt: identity.expiresAt,
    },
  }
}

// ── 修改密码 ────────────────────────────────────────────────────────

export interface ChangePasswordResult {
  data: { mustChangePassword: false }
  /** 轮换后的新 Cookie（旧 Session 已全部撤销，仅新 token 有效） */
  setCookie: string
}

/**
 * 修改密码（POST /api/admin/v1/auth/change-password）：
 * Session → CSRF → 参数/策略 → 旧密码验证 → 事务（更新哈希 + 清 must 标志 + 撤销全部 Session + 审计）
 * → 创建轮换 Session。改密后旧密码立即失效、旧 Session 全部失效。
 */
export async function changePassword(req: Request, db: AdminDb = getDrizzle()): Promise<ChangePasswordResult> {
  requireWriteOrigin(req)
  requireJson(req)
  const body = await readJsonBody(req)
  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    throw new AuthError(422, "VALIDATION_ERROR", "请求参数不正确", zodFields(parsed.error))
  }
  const { oldPassword, newPassword } = parsed.data

  const token = parseAdminToken(req.headers.get("cookie"))
  if (!token) throw new AuthError(401, "UNAUTHORIZED", "请先登录")
  const identity = await verifySession(token, db)
  if (!identity) throw new AuthError(401, "UNAUTHORIZED", "请先登录")

  const policyError = checkNewPassword(newPassword)
  if (policyError) {
    throw new AuthError(422, "VALIDATION_ERROR", policyError, { newPassword: policyError })
  }

  if (!verifyCsrfToken(hashSessionToken(token), req.headers.get("x-csrf-token"))) {
    throw new AuthError(403, "CSRF_INVALID", "CSRF 校验失败")
  }

  const userId = BigInt(identity.id)
  const rows = await db
    .select({ passwordHash: adminUsers.passwordHash })
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
    .limit(1)
  const user = rows[0]
  if (!user) throw new AuthError(401, "UNAUTHORIZED", "请先登录")

  const oldOk = await verifyPassword(oldPassword, user.passwordHash)
  if (!oldOk) throw new AuthError(401, "UNAUTHORIZED", "当前密码错误")

  const newHash = await hashPassword(newPassword)
  const now = utcNowString()
  const requestId = randomUUID()
  const prevMustChange = identity.mustChangePassword

  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({
        passwordHash: newHash,
        passwordChangedAt: now,
        mustChangePassword: false,
      })
      .where(eq(adminUsers.id, userId))
    // 该管理员全部 Session 撤销（含当前）—— 旧密码/旧会话立即失效
    await revokeAllUserSessions(userId, tx)
    await writePasswordChangeAudit(tx, userId, prevMustChange, now, req, requestId)
  })

  // 事务提交后创建轮换 Session（若失败，用户以新密码重新登录即可；安全边界不受影响）
  const session = await createSession(
    userId,
    {
      userAgent: req.headers.get("user-agent"),
      ip: resolveClientIp(req),
    },
    db,
  )

  return {
    data: { mustChangePassword: false },
    setCookie: serializeSessionCookie(session.token, session.maxAgeSec),
  }
}

/** 审计：改密动作（绝不记录任何密码/hash；before/after 只含标志位与时间） */
async function writePasswordChangeAudit(
  tx: AdminTx,
  userId: bigint,
  prevMustChange: boolean,
  now: string,
  req: Request,
  requestId: string,
): Promise<void> {
  const ip = resolveClientIp(req)
  await tx.insert(adminAuditLogs).values({
    actorUserId: userId,
    action: "auth.password_change",
    resourceType: "admin_user",
    resourceId: String(userId),
    beforeJson: { must_change_password: prevMustChange },
    afterJson: { must_change_password: false, password_changed_at: now },
    requestId,
    ipAddress: ipLiteral(ip),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
  })
}
