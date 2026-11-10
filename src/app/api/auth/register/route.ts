// 注册（Mock 1:1 源站 /auth/register）。
// 源站行为：邮箱验证码 + 图片验证码 + 用户名/密码规则 → 创建账号 → 客户端跳登录页。
// Mock 差异（文档标注）：不落盘账号（本地无用户存储），校验通过即视为成功；邮箱验证码不真实发送。
import { fail, ok, readJson, verifyCaptcha, EMAIL_RE, PWD_RE, PWD_MSG, SMS_CODE_RE, USERNAME_RE } from '@/lib/facai8/auth-api'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req)
  if (!body) return fail('请求格式错误')
  const email = String(body.email ?? '').trim()
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const code = String(body.code ?? '').trim()
  if (!email || !EMAIL_RE.test(email)) return fail('邮箱格式不正确')
  if (!USERNAME_RE.test(username)) return fail('用户名5-20位小写字母，可含数字')
  if (!PWD_RE.test(password)) return fail(PWD_MSG)
  if (!SMS_CODE_RE.test(code)) return fail('6位数字验证码')
  if (!verifyCaptcha(body)) return fail('验证码错误')
  return ok()
}
