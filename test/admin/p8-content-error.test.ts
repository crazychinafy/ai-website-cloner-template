// P8-8 测试：内容数据源故障 → 显式 ContentSourceError（带 32hex 请求编号），绝不静默回退静态数据。
// 覆盖：消息格式/无凭据泄漏、cause 保留、请求编号唯一性与日志关联、成功透传、双源都只抛不吞。
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContentSourceError } from "../../src/lib/facai8/content/errors"
import { withContentErrorBoundary } from "../../src/lib/facai8/content/source"
import { parseContentRequestId } from "../../src/components/sites/facai8/ContentError"
import type { ContentRepository } from "../../src/lib/facai8/content/repository"

const METHOD_NAMES = [
  "getHomeCategories",
  "getLinksGroupedForHome",
  "getLinksByCategory",
  "getLinksByTag",
  "getLinkById",
  "getLinkDetail",
  "getLinkMirrors",
  "getArticleCategories",
  "getArticles",
  "getArticleById",
  "getRelatedLinksForArticle",
  "getRelatedArticlesForLink",
  "getNewLinks",
  "getRecentLinks",
  "getNewArticles",
  "searchLinks",
  "searchArticles",
  "getBulletins",
  "getBulletinById",
  "getAds",
  "getTags",
  "getTagById",
  "getLines",
  "getIconLibraries",
  "getSiteSettings",
  "getSitePage",
] as const

/** 假仓库：所有方法走 behavior(方法名)；source 固定 */
function fakeRepo(source: "static" | "mysql", behavior: (method: string) => Promise<unknown>): ContentRepository {
  const target = { source } as Record<string | symbol, unknown>
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "source") return source
      if (typeof prop === "string" && METHOD_NAMES.includes(prop as (typeof METHOD_NAMES)[number])) {
        return () => behavior(prop)
      }
      return undefined
    },
  }) as unknown as ContentRepository
}

describe("ContentSourceError（P8-8 故障契约）", () => {
  it("消息 = 中文提示 + 32hex 请求编号；不含 SQL/凭据；name/source/method 字段齐全", () => {
    const err = new ContentSourceError("mysql", "getSiteSettings", new Error("Access denied"))
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("ContentSourceError")
    expect(err.source).toBe("mysql")
    expect(err.method).toBe("getSiteSettings")
    expect(err.message).toMatch(/^内容数据服务暂时不可用（mysql），请求编号 [0-9a-f]{32}$/)
    expect(err.message).not.toMatch(/Access denied/)
  })

  it("请求编号跨实例唯一；cause 保留供服务端日志", () => {
    const a = new ContentSourceError("mysql", "getAds", new Error("ECONNREFUSED"))
    const b = new ContentSourceError("mysql", "getAds", new Error("ECONNREFUSED"))
    expect(a.requestId).not.toBe(b.requestId)
    expect((a.cause as Error).message).toBe("ECONNREFUSED")
  })

  it("parseContentRequestId：ContentSourceError 消息 → 编号；其它消息 → null", () => {
    const err = new ContentSourceError("static", "getTags")
    expect(parseContentRequestId(err.message)).toBe(err.requestId)
    expect(parseContentRequestId("Something else happened")).toBeNull()
    expect(parseContentRequestId(undefined)).toBeNull()
  })
})

describe("withContentErrorBoundary（无回退故障边界）", () => {
  afterEach(() => vi.restoreAllMocks())

  /** 断言 reject 并取回错误（严格类型） */
  async function grabReject(p: Promise<unknown>): Promise<ContentSourceError> {
    try {
      await p
    } catch (e) {
      return e as ContentSourceError
    }
    throw new Error("expected rejection")
  }

  it("mysql 方法抛错 → reject ContentSourceError（source=mysql），消息不泄漏原始错误", async () => {
    const repo = fakeRepo("mysql", async () => {
      throw new Error("ER_NO_SUCH_TABLE: Table 'facai8.site_links' doesn't exist")
    })
    const bounded = withContentErrorBoundary(repo)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const p = bounded.getLinkById("110324067789312000")
    await expect(p).rejects.toBeInstanceOf(ContentSourceError)
    try {
      await p
    } catch (e) {
      const err = e as ContentSourceError
      expect(err.source).toBe("mysql")
      expect(err.method).toBe("getLinkById")
      expect(err.message).not.toMatch(/site_links|ER_NO_SUCH_TABLE/)
      // 绝不返回静态数据：只抛，不 resolve
      expect(err.requestId).toMatch(/^[0-9a-f]{32}$/)
    }
    // 服务端日志行包含与所抛错误同一 requestId（可关联）；每次失败调用各自编号
    const err1 = await grabReject(p)
    const err2 = await grabReject(bounded.getLinkById("x"))
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n")
    expect(err1.message).not.toContain("site_links")
    expect(logged).toContain(`requestId=${err1.requestId}`)
    expect(logged).toContain(`requestId=${err2.requestId}`)
    expect(err1.requestId).not.toBe(err2.requestId)
  })

  it("static 源同样只抛不吞（无静默降级路径）", async () => {
    const repo = fakeRepo("static", async () => {
      throw new Error("boom")
    })
    const bounded = withContentErrorBoundary(repo)
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(bounded.getSiteSettings()).rejects.toBeInstanceOf(ContentSourceError)
  })

  it("成功路径逐值透传（双模行为不变；不额外克隆/触碰数据）", async () => {
    const data = [{ id: "1", title: "ok" }] as unknown as never
    const repo = fakeRepo("mysql", async (m) => (m === "getNewLinks" ? data : null))
    const bounded = withContentErrorBoundary(repo)
    expect(await bounded.getNewLinks()).toBe(data)
    expect(await bounded.getLinkById("1")).toBeNull()
    expect(bounded.source).toBe("mysql")
  })

  it("已是 ContentSourceError 的错误原样再抛（同请求共享失败 Promise 时不重复编号/日志）", async () => {
    const original = new ContentSourceError("mysql", "searchLinks", new Error("down"))
    const repo = fakeRepo("mysql", async () => {
      throw original
    })
    const bounded = withContentErrorBoundary(repo)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(bounded.searchLinks("集团")).rejects.toBe(original)
    expect(spy).not.toHaveBeenCalled()
  })

  it("26 个方法全部被包装 + source 透传（契约完整性）", () => {
    const calls: string[] = []
    const repo = fakeRepo("static", async (m) => {
      calls.push(m)
      return []
    })
    const bounded = withContentErrorBoundary(repo) as unknown as Record<string, unknown>
    for (const name of METHOD_NAMES) {
      expect(typeof bounded[name]).toBe("function")
    }
    expect(bounded.source).toBe("static")
    void (bounded.getTags as () => Promise<unknown>)()
    expect(calls).toEqual(["getTags"])
  })
})
