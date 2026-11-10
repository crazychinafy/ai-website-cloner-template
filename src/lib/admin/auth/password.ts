// P3：管理员密码策略与 Argon2id 哈希（server-only）
// - 只存哈希；任何接口/日志/响应不得出现明文
// - 策略：12-128 位；允许密码管理器长随机串；禁止常见弱口令（与 P2 bootstrap 同一张表）
import "server-only"
import argon2 from "argon2"

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

// 常见弱口令（小写比较）——与 scripts/admin/bootstrap-admin.ts 保持一致
const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "admin",
  "admin123",
  "admin1234",
  "admin888",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "iloveyou",
  "abc123",
  "root",
  "root123",
  "111111",
  "000000",
  "changeme",
])

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id })
}

/** 验证失败/哈希非法一律 false（不抛错；调用方按"密码错误"统一处理） */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

// 时序均衡：用户不存在时执行同构的 hash 验证，使响应耗时不泄漏"账号是否存在"
let dummyHash: string | null = null
export async function dummyVerify(): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword(`facai8-dummy-${Math.random().toString(36).slice(2)}`)
  await verifyPassword("facai8-probe", dummyHash)
}

/** 新密码策略校验：通过返回 null，否则返回面向用户的错误文案 */
export function checkNewPassword(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `新密码至少 ${PASSWORD_MIN} 位`
  if (p.length > PASSWORD_MAX) return `新密码至多 ${PASSWORD_MAX} 位`
  if (WEAK_PASSWORDS.has(p.toLowerCase())) return "密码过于常见（弱口令），请改用密码管理器生成的长随机密码"
  return null
}
