// 密码登录（Mock 1:1 源站 /auth/login）：图片验证码校验 → 凭据判定 → HttpOnly 会话 cookie。
import { cookies } from 'next/headers'
import { credentialsOk, fail, loginPayload, ok, readJson, verifyCaptcha } from '@/lib/facai8/auth-api'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/facai8/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req)
  if (!body) return fail('请求格式错误')
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (!username || !password) return fail('请输入用户名和密码')
  if (!verifyCaptcha(body)) return fail('验证码错误')
  if (!credentialsOk(username, password)) return fail('用户名或密码错误')
  const { body: resBody, cookieValue } = loginPayload(username)
  const store = await cookies()
  store.set(SESSION_COOKIE, cookieValue, sessionCookieOptions())
  return ok(resBody.data)
}
