// POST /api/admin/v1/auth/logout —— 管理员注销（幂等；撤销 DB Session + 清 Cookie）
import { AuthError, authErrorResponse, logout } from "@/lib/admin/services/admin-auth-service.ts"
import { internal, methodNotAllow, ok } from "@/lib/admin/api/response.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const result = await logout(req)
    return ok(result.data, { headers: { "Set-Cookie": result.setCookie } })
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return internal(e, "admin auth logout")
  }
}

export async function GET() {
  return methodNotAllow("POST")
}
