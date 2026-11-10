// 发送找回密码验证码（Mock 1:1 源站 /auth/forgot-password-code）。Mock 差异：不真实发信。
import { fail, ok, readJson, verifyCaptcha, EMAIL_RE } from '@/lib/facai8/auth-api'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req)
  if (!body) return fail('请求格式错误')
  const email = String(body.email ?? '').trim()
  if (!email || !EMAIL_RE.test(email)) return fail('请输入正确的邮箱')
  if (!verifyCaptcha(body)) return fail('验证码错误')
  return ok()
}
