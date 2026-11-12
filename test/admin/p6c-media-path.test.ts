// P6C 整改（问题 03）：媒体路径统一策略 validation/media-path 单元测试
// - 站内受控素材：前缀白名单 + 已知后缀 + 禁穿越/查询串/hash/点段/相对路径
// - 站外 http(s)：显式策略（ALLOW_EXTERNAL_MEDIA），仍过 checkHttpUrl 硬校验
// - mediaPathSchema（Logo/预览图/封面图/作者头像共用）逐值合同
import { describe, expect, it } from "vitest"
import {
  ALLOW_EXTERNAL_MEDIA,
  checkHttpUrl,
  isControlledMediaPath,
  mediaSrcError,
} from "../../src/lib/admin/validation/media-path.ts"
import { logoPathSchema, mediaPathSchema } from "../../src/lib/admin/validation/link-schema.ts"

describe("isControlledMediaPath（站内受控素材唯一闸）", () => {
  it("真实历史形态与已知后缀放行", () => {
    for (const v of [
      "/uploads/2026-11-07/667f226131c64b0fbb359e3b5d2d8c9f.png", // 历史正文实际形态
      "/uploads/p6b/logo.webp", // p6b 测试真实形态
      "/uploads/a.JPG", // 大小写不敏感
      "/images/facai8/icon.gif",
      "/videos/a.mp4",
      "/sites/x/y.png",
      "/media/a.svg",
    ]) {
      expect(isControlledMediaPath(v), v).toBe(true)
    }
  })

  it("非白名单前缀 / 未知后缀 / 穿越 / 查询串 / hash / 点段 / 相对 / 反斜杠拒绝", () => {
    for (const v of [
      "/other/a.png",
      "/uploads/a.php",
      "/uploads/a.txt",
      "/uploads/x.svgz",
      "/uploads/../etc/a.png",
      "/uploads/./a.png",
      "/uploads/a.png?v=1",
      "/uploads/a.png#frag",
      "uploads/a.png",
      "\\uploads\\a.png",
      "//uploads/a.png", // 协议相对不是站内路径
      "/",
      "/uploads/", // 前缀但无文件名后缀
    ]) {
      expect(isControlledMediaPath(v), v).toBe(false)
    }
  })
})

describe("mediaSrcError（字段级统一入口）", () => {
  it("空串 = 无图直接通过", () => {
    expect(mediaSrcError("", "封面图")).toBeNull()
  })

  it("站外链接是显式策略而非默认放行", () => {
    expect(ALLOW_EXTERNAL_MEDIA).toBe(true)
    expect(mediaSrcError("https://cdn.example.com/logo.jpg", "Logo")).toBeNull() // 1 条历史绝对 Logo 原样回传
    expect(mediaSrcError("https://user:pw@cdn.example.com/a.png", "封面图")).toContain("账号密码")
    expect(mediaSrcError("ftp://cdn.example/a.png", "封面图")).toContain("http(s)")
  })

  it("站内违规给出「受控素材路径」指引文案", () => {
    const msg = mediaSrcError("/uploads/a.php", "封面图")
    expect(msg).toContain("封面图")
    expect(msg).toContain("站内受控素材路径")
    expect(msg).toContain("/uploads/")
  })

  it("协议相对 / 反斜杠 / 其他输入沿用既有文案", () => {
    expect(mediaSrcError("//cdn.example/x", "Logo")).toContain("协议相对")
    expect(mediaSrcError("\\uploads\\a.png", "Logo")).toContain("非法字符")
    expect(mediaSrcError("uploads/a.png", "Logo")).toContain("http(s)")
    expect(mediaSrcError("javascript:alert(1)", "Logo")).toContain("http(s)")
  })
})

describe("mediaPathSchema（Logo/预览图/封面/头像共用 Zod 闸）", () => {
  const cover = mediaPathSchema("封面图", 1024)

  it("合法值通过（空串/站内受控/站外 https）", () => {
    for (const v of [
      "",
      "/uploads/2026-11-07/667f226131c64b0fbb359e3b5d2d8c9f.png",
      "/images/a.jpg",
      "/videos/a.mp4",
      "https://cdn.example.com/logo.jpg",
    ]) {
      expect(cover.safeParse(v).success, v).toBe(true)
    }
  })

  it("问题 03 新增拒绝面：未知后缀/穿越/查询串/相对路径均 422 素材", () => {
    for (const v of [
      "/uploads/a.php",
      "/uploads/a.png?v=1",
      "/uploads/../../etc/passwd",
      "/etc/passwd",
      "uploads/a.png",
      "//cdn.example/a.png",
      "https://a.example.com/a.php?q='\"",
    ]) {
      const r = cover.safeParse(v)
      expect(r.success, v).toBe(false)
      if (!r.success) expect(r.error.issues[0]!.message).toContain("封面图")
    }
  })

  it("logoPathSchema 沿用同一策略且保留历史绝对 Logo 兼容", () => {
    expect(logoPathSchema.safeParse("https://old.example.com/logo.gif").success).toBe(true)
    expect(logoPathSchema.safeParse("/uploads/logo.png").success).toBe(true)
    expect(logoPathSchema.safeParse("/uploads/logo.exe").success).toBe(false)
  })

  it("checkHttpUrl 默认 label「地址」保持 httpUrlSchema 文案不变", () => {
    expect(checkHttpUrl("ftp://x.example")).toBe("只允许 http / https 协议")
    expect(checkHttpUrl("https://a.example/x")).toBeNull()
  })
})
