// 邮箱验证码登录（Mock 1:1 源站 /auth/login-by-code）。
// Mock 差异：不真实发信；任意 6 位数字码 + 图片验证码通过即以邮箱前缀建会话。
import { cookies } from 'next/headers'
import { fail, loginPayload, ok, readJson, verifyCaptcha, EMAIL_RE, SMS_CODE_RE } from '@/lib/facai8/auth-api'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/facai8/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req)
  if (!body) return fail('请求格式错误')
  const email = String(body.email ?? '').trim()
  const code = String(body.code ?? '').trim()
  if (!email || !EMAIL_RE.test(email)) return fail('邮箱格式不正确')
  if (!SMS_CODE_RE.test(code)) return fail('验证码为6位数字')
  if (!verifyCaptcha(body)) return fail('验证码错误')
  const username = email.split('@')[0].slice(0, 20)
  const { body: resBody, cookieValue } = loginPayload(username)
  const store = await cookies()
  store.set(SESSION_COOKIE, cookieValue, sessionCookieOptions())
  return ok(resBody.data)
}
