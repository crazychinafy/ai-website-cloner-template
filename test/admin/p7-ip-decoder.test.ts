// P7 测试：审计 IP 解码（VARBINARY(16) → 文本；纯函数，无 DB）
// - 覆盖驱动回传形态：Buffer / Uint8Array / latin1 二进制字符串 / 8 或 32 位 hex 字符串
// - 4 字节裸 IPv4；16 字节 MySQL IPv4（前 12 零）；::ffff:a.b.c.d 映射；::1 环回；IPv6 压缩
// - 非法/超短/空 → null（UI 显示「未知」，绝不抛错阻塞列表）
import { describe, expect, it } from "vitest"
import { decodeIp } from "../../src/lib/admin/audit/ip-decoder.ts"
import { ipToBytes } from "../../src/lib/admin/auth/session.ts"

const b = (bytes: number[]) => Buffer.from(bytes)
const v6 = (groups: number[]) => {
  const buf = Buffer.alloc(16)
  groups.forEach((g, i) => buf.writeUInt16BE(g, i * 2))
  return buf
}

describe("decodeIp", () => {
  it("4 字节裸 IPv4", () => {
    expect(decodeIp(b([1, 2, 3, 4]))).toBe("1.2.3.4")
    expect(decodeIp(b([192, 168, 1, 7]))).toBe("192.168.1.7")
    expect(decodeIp(b([255, 255, 255, 255]))).toBe("255.255.255.255")
  })

  it("16 字节 IPv4 兼容形态（本项目写入格式：前 12 字节零）", () => {
    const buf = Buffer.concat([Buffer.alloc(12), b([203, 0, 113, 7])])
    expect(decodeIp(buf)).toBe("203.0.113.7")
    expect(decodeIp(Buffer.alloc(16))).toBe("0.0.0.0")
  })

  it("IPv4-mapped ::ffff:a.b.c.d", () => {
    const buf = Buffer.concat([Buffer.alloc(10), b([0xff, 0xff]), b([1, 2, 3, 4])])
    expect(decodeIp(buf)).toBe("::ffff:1.2.3.4")
    const zeroTail = Buffer.concat([Buffer.alloc(10), b([0xff, 0xff]), Buffer.alloc(4)])
    expect(decodeIp(zeroTail)).toBe("::ffff:0.0.0.0")
  })

  it("IPv6 环回 ::1（不被 IPv4 兼容形态误判为 0.0.0.1）", () => {
    const buf = Buffer.alloc(16)
    buf[15] = 1
    expect(decodeIp(buf)).toBe("::1")
  })

  it("IPv6 最长零游程压缩（RFC 5952 风格）", () => {
    // 2001:db8::1
    expect(decodeIp(v6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]))).toBe("2001:db8::1")
    // 1:0:2:0:0:3 → 压缩长度 2 的游程（单零不压缩）
    expect(decodeIp(v6([1, 0, 2, 0, 0, 3, 4, 5]))).toBe("1:0:2::3:4:5")
    // 两段等长游程 → 首个胜出（与 inet_ntop 一致）
    expect(decodeIp(v6([1, 0, 0, 2, 0, 0, 3, 0]))).toBe("1::2:0:0:3:0")
    // 全 f
    expect(decodeIp(v6([0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff]))).toBe(
      "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    )
    // ffff 不在 10-11 字节 → 不做映射特判
    const notMapped = v6([0xffff, 0, 0, 0, 0, 0, 0xffff, 1])
    expect(decodeIp(notMapped)).toBe("ffff::ffff:1")
  })

  it("驱动回传的字符串形态：latin1 二进制串 / 32-hex / 8-hex（hex(ip_address) 投影）", () => {
    const buf = Buffer.concat([Buffer.alloc(12), b([8, 8, 8, 8])])
    expect(decodeIp(buf.toString("latin1"))).toBe("8.8.8.8")
    expect(decodeIp("20010db8000000000000000000000001")).toBe("2001:db8::1")
    expect(decodeIp("00000000000000000000000001020304")).toBe("1.2.3.4")
    // repository 用 SELECT hex(ip_address)：IPv4 行 → 8 位大写 hex
    expect(decodeIp("C0A80107")).toBe("192.168.1.7")
    expect(decodeIp("c0a80107")).toBe("192.168.1.7")
  })

  it("Uint8Array 回传形态", () => {
    expect(decodeIp(new Uint8Array([10, 0, 0, 1]))).toBe("10.0.0.1")
  })

  it("非法输入一律 null（不抛错）", () => {
    expect(decodeIp(null)).toBeNull()
    expect(decodeIp(undefined)).toBeNull()
    expect(decodeIp("")).toBeNull()
    expect(decodeIp("direct")).toBeNull()
    expect(decodeIp(b([1, 2, 3]))).toBeNull() // 3 字节
    expect(decodeIp(b([1, 2, 3, 4, 5]))).toBeNull() // 5 字节
    expect(decodeIp(Buffer.alloc(15))).toBeNull() // 15 字节
    expect(decodeIp({})).toBeNull()
    expect(decodeIp(123)).toBeNull()
  })

  it("写入→读取往返一致（ipToBytes 与 decodeIp 配对）", () => {
    for (const ip of ["203.0.113.7", "8.8.8.8", "127.0.0.1", "::1", "2001:db8::1", "fe80::1"]) {
      const bytes = ipToBytes(ip)
      expect(bytes, `ipToBytes(${ip})`).not.toBeNull()
      expect(decodeIp(bytes), `roundtrip ${ip}`).toBe(ip)
    }
    expect(ipToBytes("direct")).toBeNull()
  })
})
