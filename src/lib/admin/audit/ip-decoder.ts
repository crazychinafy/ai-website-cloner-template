// P7：审计 IP 解码（VARBINARY(16) → 展示文本）
// ─────────────────────────────────────────────────────────────────
// 编码侧见 auth/session.ts ipToBytes（MySQL INET6 形态）：
//   - IPv4：前 12 字节全零 + 4 字节八位组（本项目写入形态）
//   - IPv6：16 字节展开；::ffff:a.b.c.d 存储时第 10-11 字节为 0xff（兼容读取）
//   - 非法/未知（"direct" 等）→ NULL
// 解码侧必须覆盖：纯 IPv4 形态、IPv4-mapped、普通 IPv6、NULL、以及驱动可能回传
// 的 Buffer / Uint8Array / 二进制字符串 / hex 字符串形态。任何无法识别的输入
// 返回 null（展示为「未知」），绝不抛错阻塞列表。
import "server-only"

function toBuffer(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (typeof raw === "string") {
    if (raw.length === 0) return null
    // hex() 投影形态：大写十六进制 8 位（IPv4 4 字节）或 32 位（IPv6 16 字节）。
    // 不会误判：4/16 字节二进制解码成 JS 字符串至多 4/16 字符，凑不满 8/32 位 hex。
    if (/^[0-9a-fA-F]{8}$|^[0-9a-fA-F]{32}$/.test(raw)) return Buffer.from(raw, "hex")
    return Buffer.from(raw, "latin1") // mysql2 二进制列 JS string 为 latin1 字节保序
  }
  return null
}

/** 16 组 → RFC 4291 风格文本（小写、最长零游程压缩 "::"） */
function formatV6(bytes: Buffer): string {
  const groups: number[] = []
  for (let i = 0; i < 8; i++) groups.push(bytes.readUInt16BE(i * 2))
  // 找最长 ≥2 的零游程（首个最长者胜出，与 inet_ntop 一致）
  let bestStart = -1
  let bestLen = 0
  let start = -1
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (start < 0) start = i
    } else {
      if (start >= 0 && i - start > bestLen) {
        bestLen = i - start
        bestStart = start
      }
      start = -1
    }
  }
  if (start >= 0 && 8 - start > bestLen) {
    bestLen = 8 - start
    bestStart = start
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestLen >= 2) {
    const head = hex.slice(0, bestStart).join(":")
    const tail = hex.slice(bestStart + bestLen).join(":")
    return `${head}::${tail}` || "::"
  }
  return hex.join(":")
}

/**
 * VARBINARY(16) 原始值 → IP 文本。
 * 返回 null 表示无记录/无法解析（UI 展示「—」）。
 */
export function decodeIp(raw: unknown): string | null {
  const buf = toBuffer(raw)
  if (!buf) return null
  if (buf.length === 4) return `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`
  if (buf.length !== 16) return null

  const v4tail = () => `${buf[12]}.${buf[13]}.${buf[14]}.${buf[15]}`
  const first12Zero = () => {
    for (let i = 0; i < 12; i++) if (buf[i] !== 0) return false
    return true
  }

  // 标准 IPv4-mapped ::ffff:a.b.c.d
  if (
    buf[10] === 0xff &&
    buf[11] === 0xff &&
    Array.from(buf.subarray(0, 10)).every((b) => b === 0)
  ) {
    return `::ffff:${v4tail()}`
  }
  // IPv6 环回 ::1（避免被下面的 IPv4 兼容形态误判为 0.0.0.1）
  if (buf[15] === 1 && Array.from(buf.subarray(0, 15)).every((b) => b === 0)) return "::1"
  // 本项目 IPv4 写入形态：前 12 字节 0（含全零本身 → 0.0.0.0）
  if (first12Zero()) return v4tail()
  return formatV6(buf)
}
