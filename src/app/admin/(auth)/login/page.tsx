// /admin/login（P5 重写）：独立管理员登录页
// - returnTo 查询参数在服务端校验（只允许 /admin 前缀站内相对路径，禁止开放重定向）
// - guardLoginPage 只作用于本页面（已登录 → 跳改密页/首页）；
//   不可上移到 (auth) layout —— 会覆盖改密页造成自 307 死循环（见 layout 注释）
import { LoginForm } from "@/components/admin/LoginForm"
import { safeReturnTo } from "@/lib/admin/ui/return-to"
import { guardLoginPage } from "@/lib/admin/auth/guards.ts"

export const metadata = { title: "管理员登录 - 彩搜搜后台" }

interface Props {
  searchParams: Promise<{ returnTo?: string }>
}

export default async function AdminLoginPage({ searchParams }: Props) {
  await guardLoginPage()
  const { returnTo } = await searchParams
  return <LoginForm returnTo={safeReturnTo(returnTo ?? null)} />
}
