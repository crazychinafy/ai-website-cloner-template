// 退出登录（Mock 1:1 源站 /auth/logout）：清除会话 cookie。
import { cookies } from 'next/headers'
import { ok } from '@/lib/facai8/auth-api'
import { SESSION_COOKIE } from '@/lib/facai8/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  return ok()
}
