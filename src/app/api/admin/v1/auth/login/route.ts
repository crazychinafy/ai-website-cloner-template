// POST /api/admin/v1/auth/login —— 管理员登录
// Origin 白名单 + JSON + Zod + 限流 + Argon2id（service 内）；成功 = 新 Session HttpOnly Cookie
import { AuthError, authErrorResponse, login } from "@/lib/admin/services/admin-auth-service.ts"
import { internal, methodNotAllow, ok } from "@/lib/admin/api/response.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const result = await login(req)
    return ok(result.data, { headers: { "Set-Cookie": result.setCookie } })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return internal(e, "admin auth login")
  }
}

export async function GET() {
  return methodNotAllow("POST")
}
