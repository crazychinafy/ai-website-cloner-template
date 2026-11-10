// GET /api/admin/v1/auth/session —— 当前登录状态（未登录 401；不含 token/hash 等敏感字段）
import { AuthError, authErrorResponse, getSession } from "@/lib/admin/services/admin-auth-service.ts"
import { internal, methodNotAllow, ok } from "@/lib/admin/api/response.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const result = await getSession(req)
    return ok(result.data)
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e)
    return internal(e, "admin auth session")
  }
}

export async function POST() {
  return methodNotAllow("GET")
}
