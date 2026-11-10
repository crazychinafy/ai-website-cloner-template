// 本地图片验证码（Mock）：GET /api/auth/captcha?key=..&t=.. → 90×36 PNG。
// 源站契约：key 由客户端生成；每次请求（含点击刷新）返回新图；登录时凭 key+图中 4 字符校验。
import { ensureCaptcha, newCaptchaKey, renderCaptchaPng } from '@/lib/facai8/captcha'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  let key = url.searchParams.get('key') || ''
  if (!key) key = newCaptchaKey()
  const code = ensureCaptcha(key)
  const png = renderCaptchaPng(code)
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  })
}
