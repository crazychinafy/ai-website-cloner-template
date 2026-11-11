// P5 测试：统一 API Client（§17：信封 / 401/403/429/500 / 字段错误 / requestId / CSRF）
// Node 环境：stub 全局 fetch（"use client" 指令在 vitest 中无效，模块可直测）
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  adminApi,
  adminGet,
  adminPost,
  resetUnauthorizedGuard,
  safeReturnTo,
} from "../../src/lib/admin/ui/api-client"

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetUnauthorizedGuard()
})

describe("统一信封解析", () => {
  it("1. 成功信封 → { ok: true, data }（含 requestId 透传不暴露）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: { hello: 1 }, requestId: "r-1" })),
    )
    const res = await adminGet<{ hello: number }>("/thing")
    expect(res).toEqual({ ok: true, data: { hello: 1 } })
  })

  it("2. 401 → UNAUTHORIZED 错误（node 环境无 window → 不触发跳转）", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { success: false, error: { code: "UNAUTHORIZED", message: "请先登录" }, requestId: "r-2" }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const res = await adminGet("/auth/session")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe("UNAUTHORIZED")
      expect(res.error.status).toBe(401)
      expect(res.error.requestId).toBe("r-2")
    }
    // node 环境无 window：不抛错、不跳转
    expect(typeof window).toBe("undefined")
  })

  it("3. 403 → FORBIDDEN（不跳转）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { success: false, error: { code: "FORBIDDEN", message: "无权限" }, requestId: "r-3" }),
      ),
    )
    const res = await adminGet("/x")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN")
  })

  it("4. 429 → RATE_LIMITED + retryAfter 头解析", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          429,
          { success: false, error: { code: "RATE_LIMITED", message: "尝试次数过多" }, requestId: "r-4" },
          { "retry-after": "60" },
        ),
      ),
    )
    const res = await adminApi.login("u", "p")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe("RATE_LIMITED")
      expect(res.error.retryAfter).toBe(60)
    }
  })

  it("5. 500 → INTERNAL_ERROR + 服务端通用文案 + requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(500, { success: false, error: { code: "INTERNAL_ERROR", message: "服务内部错误" }, requestId: "r-5" }),
      ),
    )
    const res = await adminGet("/x")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe("INTERNAL_ERROR")
      expect(res.error.requestId).toBe("r-5")
    }
  })

  it("6. 500 非 JSON 响应 → 通用文案兜底（不暴露堆栈）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })))
    const res = await adminGet("/x")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe("INTERNAL_ERROR")
      expect(res.error.message).toBe("服务暂时不可用，请稍后重试")
      expect(res.error.message).not.toContain("boom")
    }
  })

  it("7. 网络异常 → NETWORK_ERROR / status 0（不抛出）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("failed to fetch"))))
    const res = await adminGet("/x")
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe("NETWORK_ERROR")
      expect(res.error.status).toBe(0)
    }
  })

  it("8. 字段级错误透传（表单展示用）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          422,
          {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "请求参数不正确", fields: { username: "用户名 3-64 位" } },
            requestId: "r-8",
          },
        ),
      ),
    )
    const res = await adminApi.login("u", "p")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.fields?.username).toBe("用户名 3-64 位")
  })
})

describe("CSRF 与写请求合同", () => {
  it("9. 写请求（POST）必须携带 X-CSRF-Token 头", async () => {
    let captured: string | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured = new Headers(init?.headers).get("x-csrf-token")
        return jsonResponse(200, { success: true, data: { ok: true } })
      }),
    )
    await adminPost("/auth/logout", {}, { csrfToken: "csrf-token-value-123" })
    expect(captured).toBe("csrf-token-value-123")
  })

  it("10. 读请求（GET）不携带 CSRF 头", async () => {
    let captured: string | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured = new Headers(init?.headers).get("x-csrf-token")
        return jsonResponse(200, { success: true, data: {} })
      }),
    )
    await adminGet("/auth/session")
    expect(captured).toBeNull()
  })

  it("11. 登录成功数据返回（mustChangePassword 分支供跳转）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          success: true,
          data: { id: "7", username: "admin", displayName: "管理员", mustChangePassword: true },
          requestId: "r-11",
        }),
      ),
    )
    const res = await adminApi.login("admin", "p")
    expect(res.ok).toBe(true)
    if (res.ok) {
      const d = res.data as { mustChangePassword: boolean }
      expect(d.mustChangePassword).toBe(true)
    }
  })

  it("12. credentials 固定 same-origin（Cookie 随同源请求；Token 不落地浏览器存储）", async () => {
    let credentials: RequestCredentials | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        credentials = init?.credentials
        return jsonResponse(200, { success: true, data: {} })
      }),
    )
    await adminGet("/auth/session")
    expect(credentials).toBe("same-origin")
  })

  it("13. 本客户端源码不引用 localStorage / sessionStorage（§17.7）", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync(new URL("../../src/lib/admin/ui/api-client.ts", import.meta.url), "utf8")
    // 先剥离注释（头部注释会把 localStorage 作为设计说明提及），再对代码断言
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
    expect(code).not.toMatch(/localStorage|sessionStorage/)
  })
})

describe("safeReturnTo（防开放重定向，§7）", () => {
  it("13. 允许 /admin 前缀站内相对路径", () => {
    expect(safeReturnTo("/admin")).toBe("/admin")
    expect(safeReturnTo("/admin/links")).toBe("/admin/links")
    expect(safeReturnTo("/admin/change-password")).toBe("/admin/change-password")
  })

  it("14. 拒绝协议相对 / 绝对 URL / 非法输入", () => {
    expect(safeReturnTo("//evil.com")).toBeNull()
    expect(safeReturnTo("https://evil.com")).toBeNull()
    expect(safeReturnTo("/front")).toBeNull() // 非 /admin 前缀
    expect(safeReturnTo("\\evil")).toBeNull()
    expect(safeReturnTo(null)).toBeNull()
    expect(safeReturnTo("")).toBeNull()
    expect(safeReturnTo("/admin" + "x".repeat(300))).toBeNull()
  })
})

// AdminResult 类型面由 adminGet/adminPost/adminApi 的返回类型覆盖（无需独立断言）
