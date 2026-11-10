// 重置密码（Mock 1:1 源站 /auth/reset-password）。Mock 差异：无密码存储，校验通过即 200。
import { fail, ok, readJson, verifyCaptcha, EMAIL_RE, PWD_RE, PWD_MSG, SMS_CODE_RE } from '@/lib/facai8/auth-api'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req)
  if (!body) return fail('请求格式错误')
  const email = String(body.email ?? '').trim()
  const code = String(body.code ?? '').trim()
  const password = String(body.password ?? '')
  if (!email || !EMAIL_RE.test(email)) return fail('邮箱格式不正确')
  if (!SMS_CODE_RE.test(code)) return fail('验证码为6位数字')
  if (!PWD_RE.test(password)) return fail(PWD_MSG)
  if (!verifyCaptcha(body)) return fail('验证码错误')
  return ok()
}
