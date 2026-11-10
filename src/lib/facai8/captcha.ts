// 本地图片验证码（Mock 认证组件）：无第三方依赖——手写 90×36 PNG（node:zlib）+ 5×7 位图字体。
// 视觉规格按源站实测复刻：浅色渐变底（#f6f6fe→#e9e9f1）+ 4 字符随机配色（青/橙/橄榄/蓝/紫，采样自源站 PNG 直方图）。
// 存储：进程内 Map（本地单实例 mock；10 分钟 TTL）。每次请求图片生成新码（源站点击刷新即换图、清空输入）。
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const W = 90
const H = 36
// 排除易混淆的 0/O/1/I（源站校验正则仍接受全部 [A-Za-z0-9]，这里只收窄生成集）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PALETTE: Array<[number, number, number]> = [
  [45, 100, 100],
  [155, 50, 10],
  [85, 110, 35],
  [45, 70, 150],
  [120, 40, 90],
]

// 5×7 位图字体（0-9 + A-Z；排除易混淆字符后仍备全，生成端由 ALPHABET 控制）
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['01110', '10001', '00001', '01110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
}

function randomCode(): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += ALPHABET[randomBytes(1)[0] % ALPHABET.length]
  return s
}

// ─── 最小 PNG 编码器（RGB、8bit、无 alpha）────────────────────────
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
export function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0 // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))])
}

// 渲染：3× 超采样画字符后盒式降采样（免费抗锯齿，逼近源站的平滑字形）
export function renderCaptchaPng(code: string): Buffer {
  const S = 3
  const sw = W * S
  const sh = H * S
  const big = Buffer.alloc(sw * sh * 3)
  // 背景：垂直渐变（源站采样：上 #f6f6fe 下 #e9e9f1）
  for (let y = 0; y < sh; y++) {
    const t = y / (sh - 1)
    const r = Math.round(246 - 13 * t)
    const g = Math.round(246 - 13 * t)
    const b = Math.round(254 - 13 * t)
    for (let x = 0; x < sw; x++) {
      const o = (y * sw + x) * 3
      big[o] = r
      big[o + 1] = g
      big[o + 2] = b
    }
  }
  // 噪点（浅色小点）
  for (let i = 0; i < 14; i++) {
    const x = randomBytes(1)[0] % sw
    const y = randomBytes(1)[0] % sh
    const v = 190 + (randomBytes(1)[0] % 30)
    const o = (y * sw + x) * 3
    big[o] = v
    big[o + 1] = v
    big[o + 2] = v + 12
  }
  // 字符
  for (let i = 0; i < code.length; i++) {
    const glyph = FONT[code[i]]
    if (!glyph) continue
    const [cr, cg, cb] = PALETTE[randomBytes(1)[0] % PALETTE.length]
    const ox = (7 + i * 20 + (randomBytes(1)[0] % 5) - 2) * S
    const oy = (7 + (randomBytes(1)[0] % 7) - 3) * S
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue
        for (let dy = 0; dy < S; dy++) {
          for (let dx = 0; dx < S; dx++) {
            const x = ox + gx * S + dx
            const y = oy + gy * S + dy
            if (x < 0 || y < 0 || x >= sw || y >= sh) continue
            const o = (y * sw + x) * 3
            big[o] = cr
            big[o + 1] = cg
            big[o + 2] = cb
          }
        }
      }
    }
  }
  // 盒式降采样
  const rgb = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const o = ((y * S + dy) * sw + (x * S + dx)) * 3
          r += big[o]
          g += big[o + 1]
          b += big[o + 2]
        }
      }
      const n = S * S
      const o = (y * W + x) * 3
      rgb[o] = Math.round(r / n)
      rgb[o + 1] = Math.round(g / n)
      rgb[o + 2] = Math.round(b / n)
    }
  }
  return encodePng(W, H, rgb)
}

// ─── 会话存储（进程内；每次请求图片 → 该 key 换新码）────────────────
const store = new Map<string, { code: string; at: number }>()
const TTL = 10 * 60 * 1000

function sweep() {
  const now = Date.now()
  for (const [k, v] of store) if (now - v.at > TTL) store.delete(k)
}

/** 确保 key 有码（新 key 或已过期 → 生成新码）。每次调用都换码，对齐源站刷新行为 */
export function ensureCaptcha(key: string): string {
  sweep()
  const code = randomCode()
  store.set(key, { code, at: Date.now() })
  return code
}

/** 校验并消费（源站语义：一次有效） */
export function checkCaptcha(key: string, input: string): boolean {
  const v = store.get(key)
  if (!v || Date.now() - v.at > TTL) return false
  store.delete(key)
  return v.code === (input || '').trim()
}

export function newCaptchaKey(): string {
  return randomBytes(6).toString('base64url').slice(0, 11)
}
