// P6D：服务端静态图片路径解析器（广告 imagePath / 站点 Logo / favicon 的单一事实源）
// ─────────────────────────────────────────────────────────────────
// 与客户端可导入的 validation/media-path.ts（语法策略层）互补：本模块是 server-only 的
// 「文件存在性 + 沙箱 containment」层。P6D §5.8 安全要求：
// 1. 仅允许项目已知静态图片目录（public/ 下的 /sites/facai8/images、/images、/videos、/seo；
//    历史 /uploads/<日期>/<hash>.<ext> 按前端冻结的 asset() 同一规则映射 basename 到 images 目录）
// 2. 文件必须真实存在且为普通文件（lstat/realpath + isFile）
// 3. 禁路径穿越（含 URL 编码后的二次穿越检查）、禁反斜杠、禁控制字符、禁查询串/hash
// 4. 符号链接逃逸检查：realpath 后必须仍在同一静态根内（readRealFile 验证）
// 5. 扩展名白名单 = 位图图标（png/jpg/jpeg/gif/webp/avif/ico）；明确禁 SVG/HTML（XSS 面）、
//    禁 mp4（广告图/Logo 不是视频）
// 6. 禁外部图片 URL / 协议相对 //（与 §5.8-8、§7.5 一致；比富文本正文策略更严）
// 7. 错误信息不暴露绝对文件系统路径；且不发起任何网络请求（SSRF 禁令）
import "server-only"
import path from "node:path"
import { promises as fs } from "node:fs"

/**
 * 静态资源根（public/）；与 Next.js 静态文件服务口径一致。
 * 注意：不能用 `new URL("../../public", import.meta.url)`——那是 Turbopack 的
 * 「构建期资源引用」语法，引用目录会在 build 时报模块找不到。nodejs runtime
 * 的服务端路由与 vitest 都在项目根运行，process.cwd() 即项目根。
 */
const PUBLIC_ROOT = path.resolve(process.cwd(), "public")

/** 站内已知图片目录（公开路径前缀 → 物理目录）。历史 /uploads/ 走 asset() basename 映射，单独处理 */
const KNOWN_IMAGE_DIRS = ["/sites/facai8/images/", "/images/", "/videos/", "/seo/"] as const

/** 位图扩展名白名单（禁 svg/html —— 广告图与 Logo 不接受矢量/文档型文件） */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|ico)$/i
const CONTROL_RE = /[\x00-\x20\x7f]/

/** URL 解码（编码穿越防御：先解码再检查段）；非法编码 → 拒绝 */
function decodeSafe(v: string): string | null {
  try {
    return decodeURIComponent(v)
  } catch {
    return null
  }
}

export type StaticImageResult = { ok: true; publicPath: string } | { ok: false; message: string }

/**
 * 解析并验证一个站内静态图片引用；返回归一化的公开路径（原样可回写 DB）或安全错误文案。
 * - label 仅用于错误文案（如「广告图片」「站点 Logo」）
 * - 语法层复用 media-path.ts 的站内路径判定精神，但存在性 + 符号链接检查必须走本模块
 */
export async function resolveStaticImagePath(value: string, label: string): Promise<StaticImageResult> {
  const v = value.trim()
  if (v === "") return { ok: false, message: `${label}不能为空` }
  if (CONTROL_RE.test(v) || v.includes("\\")) return { ok: false, message: `${label}包含非法字符` }
  if (/^https?:/i.test(v)) return { ok: false, message: `${label}不允许外部图片链接，必须是站内静态图片路径` }
  if (v.startsWith("//")) return { ok: false, message: `${label}不支持协议相对链接（// 开头）` }
  if (!v.startsWith("/")) return { ok: false, message: `${label}必须是站内路径（/ 开头）` }
  if (v.includes("?") || v.includes("#")) return { ok: false, message: `${label}不允许查询串或锚点` }
  if (!IMAGE_EXT_RE.test(v)) return { ok: false, message: `${label}扩展名必须是 png/jpg/jpeg/gif/webp/avif/ico（不允许 SVG、HTML、可执行文件）` }

  const decoded = decodeSafe(v)
  if (decoded === null) return { ok: false, message: `${label}包含非法 URL 编码` }
  // 编码前后的路径段都不允许 . / ..（%2e%2e%2f 双重解码穿越）
  const segments = (seg: string) => seg.split("/").some((s) => s === "." || s === "..")
  if (segments(v) || segments(decoded)) return { ok: false, message: `${label}包含路径穿越` }
  if (CONTROL_RE.test(decoded)) return { ok: false, message: `${label}包含非法控制字符` }

  // 前缀判定（用解码后形态比较；物理路径也用解码后形态构造）
  let physical: string | null = null
  let root: string | null = null
  if (decoded.startsWith("/uploads/")) {
    // 历史源站路径：与前端冻结的 asset() 完全同规则 —— 取 basename 映射到 images 目录
    const base = decoded.split("/").pop() ?? ""
    if (!base || segments(base)) return { ok: false, message: `${label}包含路径穿越` }
    physical = path.join(PUBLIC_ROOT, "sites", "facai8", "images", base)
    root = path.join(PUBLIC_ROOT, "sites", "facai8", "images")
  } else {
    const dir = KNOWN_IMAGE_DIRS.find((p) => decoded.startsWith(p))
    if (!dir) {
      return {
        ok: false,
        message: `${label}必须是站内静态图片目录（${KNOWN_IMAGE_DIRS.join("、")}，或历史 /uploads/ 路径）`,
      }
    }
    physical = path.join(PUBLIC_ROOT, decoded)
    root = path.join(PUBLIC_ROOT, dir.slice(0, -1))
  }
  physical = path.resolve(physical)
  root = path.resolve(root)
  if (!physical.startsWith(root + path.sep)) return { ok: false, message: `${label}超出站内静态图片目录` }

  // 存在性 + 普通文件 + 符号链接 containment（realpath 逃逸检查）
  let real: string
  try {
    real = await fs.realpath(physical)
  } catch {
    return { ok: false, message: `${label}对应的文件不存在` }
  }
  if (real !== physical && !real.startsWith(root + path.sep) && !real.startsWith(PUBLIC_ROOT + path.sep)) {
    return { ok: false, message: `${label}对应的文件不在受控静态目录内` }
  }
  const st = await fs.stat(real).catch(() => null)
  if (!st) return { ok: false, message: `${label}对应的文件不存在` }
  if (!st.isFile()) return { ok: false, message: `${label}必须指向一个普通文件` }
  return { ok: true, publicPath: v }
}

/** Zod/Service 便捷封装：失败时返回错误文案，成功返回 null（字段级校验形态） */
export async function staticImageError(value: string, label: string): Promise<string | null> {
  const r = await resolveStaticImagePath(value, label)
  return r.ok ? null : r.message
}
