// P6D §5.8/§7.5：服务端静态图片路径解析器单测（不连库）
// - 已知静态目录 + 历史 /uploads/ basename 映射（与冻结前台 asset() 同规则）
// - 禁外链 / 协议相对 / 查询串 / 反斜杠 / 控制字符 / 扩展名白名单（禁 SVG/HTML/mp4）
// - 路径穿越（含 %2e%2e%2f 编码二次穿越）、文件必须存在且为普通文件
// - 符号链接逃逸：realpath 出 public 根 → 拒绝（无权限环境优雅降级）
// - 错误信息不得泄露文件系统绝对路径
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { resolveStaticImagePath, staticImageError } from "../../src/lib/admin/security/media-file.ts"

const PUBLIC_ROOT = path.resolve(fileURLToPath(new URL("../../public", import.meta.url)))
const FIX_DIR = path.join(PUBLIC_ROOT, "sites", "facai8", "images", "__p6d_test__")
const OUTSIDE_DIR = path.join(os.tmpdir(), "p6d-media-outside", "outside")
const REAL_PNG = "/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png"

let symlinkWorked = false

beforeAll(async () => {
  await fs.mkdir(FIX_DIR, { recursive: true })
  await fs.mkdir(OUTSIDE_DIR, { recursive: true })
  // 目录伪装 .png（存在但不是普通文件）
  await fs.mkdir(path.join(FIX_DIR, "fake-dir.png"), { recursive: true })
  // 站外真图 + 逃逸符号链接（Windows 非管理员可能失败 → 用例内降级）
  await fs.writeFile(path.join(OUTSIDE_DIR, "outside.png"), "PNGDATA", "utf8")
  const link = path.join(FIX_DIR, "escape.png")
  try {
    await fs.rm(link, { force: true })
    await fs.symlink(path.join(OUTSIDE_DIR, "outside.png"), link, "file")
    symlinkWorked = true
  } catch {
    symlinkWorked = false
  }
})

afterAll(async () => {
  await fs.rm(FIX_DIR, { recursive: true, force: true })
  await fs.rm(path.dirname(OUTSIDE_DIR), { recursive: true, force: true })
})

async function failMsg(v: string): Promise<string> {
  const r = await resolveStaticImagePath(v, "广告图片")
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error("expected failure")
  return r.message
}

describe("resolveStaticImagePath：接受形态", () => {
  it("已知目录内真实文件 → ok 且原样返回公开路径", async () => {
    const r = await resolveStaticImagePath(REAL_PNG, "广告图片")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.publicPath).toBe(REAL_PNG)
  })

  it("历史 /uploads/ 路径按 basename 映射到 images 目录（14 条存量广告形态）", async () => {
    const r = await resolveStaticImagePath("/uploads/2026/09/19/22bb856abdab4f4eae80039cee3b3365.png", "站点 Logo")
    expect(r.ok).toBe(true)
  })

  it("站内 .ico（favicon 形态）不被扩展名误杀", async () => {
    await fs.writeFile(path.join(FIX_DIR, "fav.ico"), "ICO", "utf8")
    const r = await resolveStaticImagePath("/sites/facai8/images/__p6d_test__/fav.ico", "站点 Favicon")
    expect(r.ok).toBe(true)
  })
})

describe("resolveStaticImagePath：拒绝形态", () => {
  it("外部 http(s) 图片链接（禁外链，§7.5）", async () => {
    expect(await failMsg("https://example.com/a.png")).toContain("外部图片链接")
    expect(await failMsg("http://example.com/a.png")).toContain("外部图片链接")
  })

  it("协议相对 //", async () => {
    expect(await failMsg("//example.com/a.png")).toContain("协议相对")
  })

  it("站内相对路径（无 / 开头）", async () => {
    expect(await failMsg("images/a.png")).toContain("站内路径")
  })

  it("查询串 / hash", async () => {
    expect(await failMsg(`${REAL_PNG}?v=1`)).toContain("查询串")
    expect(await failMsg(`${REAL_PNG}#top`)).toContain("查询串")
  })

  it("扩展名白名单：SVG/HTML/mp4/无扩展名一律拒绝（XSS 面）", async () => {
    for (const bad of ["/images/x.svg", "/images/x.html", "/images/x.htm", "/videos/x.mp4", "/images/noext", "/images/x.exe"]) {
      const msg = await failMsg(bad)
      expect(msg, bad).toContain("扩展名")
    }
  })

  it("未知目录 → 拒绝", async () => {
    expect(await failMsg("/secret-dir/x.png")).toContain("静态图片目录")
  })

  it("路径穿越（明文与 %2e%2e%2f 编码双重穿越）", async () => {
    expect(await failMsg("/sites/facai8/images/../../private/x.png")).toContain("路径穿越")
    expect(await failMsg("/sites/facai8/images/%2e%2e%2f%2e%2e%2fprivate/x.png")).toContain("路径穿越")
    expect(await failMsg("/sites/facai8/images/%252e%252e/x.png")).not.toBe("")
  })

  it("反斜杠与控制字符", async () => {
    expect(await failMsg("/sites/facai8/images\\x.png")).toContain("非法字符")
    expect(await failMsg("/sites/facai8/images/a\nb.png")).toContain("非法字符")
  })

  it("非法 URL 编码", async () => {
    expect(await failMsg("/images/%zz.png")).toContain("URL 编码")
  })

  it("空值", async () => {
    expect(await failMsg("   ")).toContain("不能为空")
  })

  it("文件不存在 → 拒绝（不泄露文件系统路径）", async () => {
    const msg = await failMsg("/sites/facai8/images/definitely-missing-file.png")
    expect(msg).toContain("不存在")
    expect(msg).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(msg).not.toContain(PUBLIC_ROOT)
  })

  it("存在但不是普通文件（目录伪装 .png）", async () => {
    expect(await failMsg("/sites/facai8/images/__p6d_test__/fake-dir.png")).toContain("普通文件")
  })

  it("符号链接指向 public 之外 → 拒绝（逃逸检查）", async () => {
    const r = await resolveStaticImagePath("/sites/facai8/images/__p6d_test__/escape.png", "广告图片")
    if (!symlinkWorked) {
      // 无符号链接权限：文件根本不存在 → 仍必须被拒绝（fail-closed）
      expect(r.ok).toBe(false)
      return
    }
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain("受控静态目录")
  })

  it("任何失败文案都不含文件系统绝对路径", async () => {
    const cases = ["x.png", "//cdn.example.com/a.png", "/sites/facai8/images/../../x.png", "/nope/a.png", "/nope/a.png?v"]
    for (const c of cases) {
      const msg = await failMsg(c)
      expect(msg, c).not.toMatch(/[A-Za-z]:[\\/]/)
      expect(msg, c).not.toContain(PUBLIC_ROOT)
    }
  })
})

describe("staticImageError 封装", () => {
  it("成功 → null；失败 → 错误文案", async () => {
    expect(await staticImageError(REAL_PNG, "广告图片")).toBeNull()
    expect(typeof (await staticImageError("javascript:x", "广告图片"))).toBe("string")
  })
})
