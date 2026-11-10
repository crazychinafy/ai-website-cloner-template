// Mock 认证决策（服务端）：独立于源站，凭据仅来自环境变量；会话 = HttpOnly cookie。
// 源站语义对照：
//  - 源站为 SPA + localStorage token；本地改为服务端 HttpOnly cookie（任务书要求）。
//  - 源站登录成功返回 {code:200, data:{token, username}}；本地保留同形（token 为 mock 占位）。
//  - 凭据：设置了 SOURCE_TEST_USERNAME/PASSWORD 环境变量 → 仅该测试账号可登录；
//    未设置 → 任意非空用户名+密码可登录（本地演示兜底，console.warn 提示）。
import { encodeSession, testCredentials, type SessionUser } from './auth'
import { CAPTCHA_RE, EMAIL_RE, PWD_MSG, PWD_RE, SMS_CODE_RE, USERNAME_RE } from './auth-rules'
import { checkCaptcha } from './captcha'

export function ok(data?: object) {
  return Response.json({ code: 200, data: data ?? {} })
}

export function fail(message: string) {
  return Response.json({ code: 500, message }, { status: 200 })
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const o = (await req.json()) as Record<string, unknown>
    return typeof o === 'object' && o !== null ? o : null
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 图片验证码校验（消费一次）；key 缺失/不匹配 → false */
export function verifyCaptcha(body: Record<string, unknown>): boolean {
  const key = str(body.captchaKey)
  if (!key) return false
  return checkCaptcha(key, str(body.captcha))
}

/** 登录成功：返回源站同形 body + 待写入的会话 cookie 值（route 用 cookies().set 落 cookie） */
export function loginPayload(username: string): {
  body: { code: number; data: { token: string; username: string } }
  cookieValue: string
} {
  const user: SessionUser = { username, avatar: null }
  return {
    body: { code: 200, data: { token: 'local-mock-session', username } },
    cookieValue: encodeSession(user),
  }
}

/** 密码登录凭据判定（1:1 源站 /auth/login 的语义） */
export function credentialsOk(username: string, password: string): boolean {
  const cred = testCredentials()
  if (cred) return username === cred.username && password === cred.password
  // 未注入测试账号时：本地演示兜底（任意非空凭据放行）
  if (!process.env.SOURCE_AUTH_ENV_WARNTED) {
    console.warn('[facai8] SOURCE_TEST_USERNAME/PASSWORD 未设置，mock 登录放行任意非空凭据（仅本地演示）')
    process.env.SOURCE_AUTH_ENV_WARNTED = '1'
  }
  return username.length > 0 && password.length > 0
}

export { CAPTCHA_RE, EMAIL_RE, PWD_MSG, PWD_RE, SMS_CODE_RE, USERNAME_RE }
