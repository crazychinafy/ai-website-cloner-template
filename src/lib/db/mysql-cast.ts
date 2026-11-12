// mysql2 VARBINARY 回读修复（client.ts 池与测试池共用同一 typeCast，保证测试=生产形态）
// ─────────────────────────────────────────────────────────────────
// MySQL 结果集把 VARBINARY 列按「连接字符集」打戳（BLOB 才打 binary 戳），mysql2 因此在
// utf8mb4 连接下把它当文本解码：字节 ≥0x80（如 IPv4 高位八位组 0xC0 0xA8、IPv6 常见值）
// 被替换为 U+FFFD，信息在驱动解码层就已不可逆丢失（253.253.x.x 假 IP 的根因）。
// 唯一可靠读法：typeCast 里对声明的 varbinary 业务列用 field.buffer() 直接取行包原始字节。
// NULL：typeCast 同样被调用，field.buffer() 返回 null（decodeIp 已处理）。
import "server-only"

interface CastField {
  table: string
  name: string
  buffer: () => Buffer | null
}

/** 声明式清单：表名 → varbinary 列名（新增 varbinary 列时在此登记） */
const VARBINARY_COLUMNS: Record<string, readonly string[]> = {
  admin_audit_logs: ["ip_address"],
}

export function binaryColumnCast(field: CastField, next: () => unknown): unknown {
  const cols = VARBINARY_COLUMNS[field.table]
  if (cols && cols.includes(field.name)) return field.buffer()
  return next()
}
