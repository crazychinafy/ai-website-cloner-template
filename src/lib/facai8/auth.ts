// 本地会话（Mock 认证）：HttpOnly cookie 存储登录态
import { cookies } from 'next/headers'
import { createHash, randomUUID } from 'node:crypto'

export const SESSION_COOKIE = 'facai8_session'

export interface SessionUser {
  username: string
  avatar: string | null
}

function cookieValue(u: SessionUser): string {
  const payload = JSON.stringify({ u: u.username, a: u.avatar, s: createHash('sha256').update(u.username + randomUUID()).digest('hex').slice(0, 32) })
  return Buffer.from(payload).toString('base64url')
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const v = store.get(SESSION_COOKIE)?.value
  if (!v) return null
  try {
    const o = JSON.parse(Buffer.from(v, 'base64url').toString('utf8'))
    if (o && typeof o.u === 'string') return { username: o.u, avatar: typeof o.a === 'string' ? o.a : null }
  } catch {
    return null
  }
  return null
}

/** 测试账号仅从环境变量读取（不落盘、不入代码） */
export function testCredentials(): { username: string; password: string } | null {
  const u = process.env.SOURCE_TEST_USERNAME
  const p = process.env.SOURCE_TEST_PASSWORD
  if (!u || !p) return null
  return { username: u, password: p }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false, // 本地 http 开发
    path: '/',
    maxAge: 7 * 24 * 3600,
  }
}

export function encodeSession(u: SessionUser): string {
  return cookieValue(u)
}
