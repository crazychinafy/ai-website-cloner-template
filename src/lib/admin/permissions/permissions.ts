// P3：RBAC 角色/权限实时加载（安全文档 §3）
// - 角色仅是权限集合；业务判断一律基于 permission code，禁止散落 role === 'admin'
// - 每次请求重新查库：角色/权限变更后下一次请求立即生效（无长期缓存）
import "server-only"
import { eq, inArray } from "drizzle-orm"
import { adminPermissions, adminRolePermissions, adminRoles, adminUserRoles } from "@/lib/db/schema"
import type { AdminDb } from "@/lib/db/client"
import { getDrizzle } from "@/lib/db/client"

export interface RoleAndPermissionSet {
  /** 角色 code（去重排序） */
  roles: string[]
  /** 权限 code（去重排序；跨角色并集） */
  permissions: string[]
}

/**
 * 加载管理员当前角色与权限（实时查库）。
 * 无角色 → roles/permissions 均为空数组（登录成功但无权限 = 只能看首页）。
 */
export async function loadUserRolesAndPermissions(
  userId: bigint,
  db: AdminDb = getDrizzle(),
): Promise<RoleAndPermissionSet> {
  const roleRows = await db
    .select({ code: adminRoles.code })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminUserRoles.roleId, adminRoles.id))
    .where(eq(adminUserRoles.userId, userId))
  const roles = [...new Set(roleRows.map((r) => r.code))].sort()
  if (roles.length === 0) return { roles: [], permissions: [] }

  const permRows = await db
    .select({ code: adminPermissions.code })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminUserRoles.roleId, adminRoles.id))
    .innerJoin(adminRolePermissions, eq(adminRolePermissions.roleId, adminRoles.id))
    .innerJoin(adminPermissions, eq(adminRolePermissions.permissionId, adminPermissions.id))
    .where(eq(adminUserRoles.userId, userId))
  return { roles, permissions: [...new Set(permRows.map((r) => r.code))].sort() }
}

/** 判断权限集是否包含某权限（纯函数，供守卫/UI 共用） */
export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission)
}

/** 校验某权限 code 是否在权限字典中存在（启动/守卫自检用，防代码假设权限存在） */
export async function permissionExists(code: string, db: AdminDb = getDrizzle()): Promise<boolean> {
  const rows = await db.select({ id: adminPermissions.id }).from(adminPermissions).where(inArray(adminPermissions.code, [code])).limit(1)
  return rows.length > 0
}
