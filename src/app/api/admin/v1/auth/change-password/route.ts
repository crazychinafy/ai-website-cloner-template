// POST /api/admin/v1/auth/change-password —— 修改管理员密码
// Session + CSRF + 策略校验 + 旧密码验证 → 改密并撤销全部旧 Session → 返回轮换后新 Cookie
import { AuthError, authErrorResponse, changePassword } from "@/lib/admin/services/admin-auth-service.ts"
import { internal, methodNotAllow, ok } from "@/lib/admin/api/response.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const result = await changePassword(req)
    return ok(result.data, { headers: { "Set-Cookie": result.setCookie } })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return internal(e, "admin auth change-password")
  }
}

export async function GET() {
  return methodNotAllow("POST")
}
