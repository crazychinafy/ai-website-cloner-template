// GET /api/admin/v1/settings —— 站点设置（白名单 6 key；首次访问按 SITE_INFO 默认值幂等补建）
// PATCH /api/admin/v1/settings —— 部分更新（items[{key,value,version}]；单事务 + 逐 key 乐观锁 + 审计）
import { handleRead, handleWrite, methodNotAllowed } from "@/lib/admin/api/handler.ts"
import { patchSettingsSchema } from "@/lib/admin/validation/site-setting-schema.ts"
import { getSettings, updateSettings } from "@/lib/admin/services/site-setting-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return handleRead(req, "settings.read", "admin settings get", () => getSettings())
}

export async function PATCH(req: Request) {
  return handleWrite(req, "settings.update", "admin settings update", patchSettingsSchema, (_admin, ctx, body) =>
    updateSettings(ctx, body),
  )
}

export async function PUT() {
  return methodNotAllowed("GET, PATCH")
}
