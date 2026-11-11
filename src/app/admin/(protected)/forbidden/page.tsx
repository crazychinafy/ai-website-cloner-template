// /admin/forbidden：403 权限不足视图（任务书 §14 ForbiddenState 的落地页）
// - 服务端守卫保证：只有已登录管理员能到达这里；
//   未来受权限保护的页面（P6+）在 requireAdminPermission 失败时渲染/跳转本页
import { ForbiddenState } from "@/components/admin/feedback/ForbiddenState"

export const metadata = { title: "权限不足 - 彩搜搜后台" }

export default function AdminForbiddenPage() {
  return <ForbiddenState className="mt-4" />
}
