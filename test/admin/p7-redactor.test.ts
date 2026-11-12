// P7 测试：统一脱敏器（写入/读取共用同一实现；纯函数，无 DB）
// - 敏感 key（password/token/secret/session/cookie/authorization/csrf/api_key/credential…）→ ***
// - 递归对象与数组（嵌套）；URL query token、Authorization/Cookie、key=value、DSN 口令
// - authorName / monkey 等含子串的普通 key 不得误伤（key 规则不含裸 "auth"/"key" 子串）
// - 深度 / 列表 / 字符串长度防御上限；循环引用；fail-closed
import { describe, expect, it } from "vitest"
import {
  REDACT_DEPTH_LIMIT,
  REDACT_LIST_LIMIT,
  REDACT_MASK,
  REDACT_STRING_LIMIT,
  isSecretKey,
  redactAuditValue,
  redactErrorText,
  scrubText,
} from "../../src/lib/admin/audit/redactor.ts"

describe("isSecretKey", () => {
  it("敏感 key 命中（大小写 / 派生名）", () => {
    for (const k of ["password", "Password", "newPassword", "pwd", "token", "tokenHash", "sessionToken", "secret", "apiKey", "API_KEY", "api_key", "accessToken", "authorization", "Authorization", "cookie", "cookieHeader", "csrfToken", "credential", "credentials", "passphrase", "signature", "pin", "otp", "auth"]) {
      expect(isSecretKey(k)).toBe(true)
    }
  })

  it("普通 key 不误伤（裸 auth/key 只作精确匹配，不作子串）", () => {
    // auth/pin/otp 仅精确命中；authorization/session 等仍按子串命中
    for (const k of ["authorName", "author", "monkey", "keynote", "key", "keyName", "keyword", "authGroup", "title", "username"]) {
      expect(isSecretKey(k)).toBe(false)
    }
    expect(isSecretKey("auth")).toBe(true) // 裸 auth 精确命中
    expect(isSecretKey("authorizationCode2")).toBe(true) // authorization 子串命中
    expect(isSecretKey("sessions2")).toBe(true) // session 子串命中
  })
})

describe("scrubText（字符串内容清洗）", () => {
  it("URL query 凭据参数", () => {
    expect(scrubText("https://api.example.com/v1?name=ok&token=abc.def&api_key=zz99&page=2")).toBe(
      "https://api.example.com/v1?name=ok&token=***&api_key=***&page=2",
    )
  })

  it("Authorization / Cookie / X-CSRF-Token 头样式", () => {
    expect(scrubText("Authorization: Bearer eyJhbGciOi.abc.ghi")).toBe(`Authorization: ${REDACT_MASK}`)
    expect(scrubText("Cookie: sid=xyz; theme=dark")).toBe(`Cookie: ${REDACT_MASK}`)
    // 头样式先脱敏到行尾；随后 key=value 规则把 Token 类 key 的分隔符归一为 =（掩码不变）
    expect(scrubText("X-CSRF-Token: t0k3n")).toBe(`X-CSRF-Token=${REDACT_MASK}`)
  })

  it("引号包裹的凭据值也被脱敏（日志 / JSON 文本常见形态）", () => {
    expect(scrubText('token="live_abc"')).toBe(`token=${REDACT_MASK}`)
    expect(scrubText("password='p@ss w0rd'")).toBe(`password=${REDACT_MASK}`)
    expect(scrubText('{"api_key":"sk-abcdef","note":"ok"}')).toContain(`${REDACT_MASK}`)
    expect(scrubText('{"api_key":"sk-abcdef","note":"ok"}')).not.toContain("sk-abcdef")
  })

  it("key=value / key: value 凭据与 DSN 口令", () => {
    expect(scrubText('connect failed password=hunter2, user=root')).toBe(`connect failed password=${REDACT_MASK}, user=root`)
    expect(scrubText("DB_PASSWORD: s3cr3t")).toBe(`DB_PASSWORD=${REDACT_MASK}`)
    expect(scrubText("mysql://facai8:S3cret@127.0.0.1:3306/db")).toBe(`mysql://facai8:${REDACT_MASK}@127.0.0.1:3306/db`)
  })

  it("无敏感内容时原样保留", () => {
    expect(scrubText("文章「你好」更新成功（id=7）")).toBe("文章「你好」更新成功（id=7）")
  })
})

describe("redactAuditValue（结构化脱敏）", () => {
  it("敏感 key 值替换为掩码（结构/键名保留）", () => {
    const out = redactAuditValue({
      username: "admin01",
      password: "Sup3r-Secret!",
      passwordHash: "$argon2id$v=19$m=65536",
      token: "tok_live_zzz9999",
      nested: { apiKey: "sk-abcdef123456", authorization: "Bearer x.y" },
    }) as Record<string, unknown>
    expect(out.username).toBe("admin01")
    expect(out.password).toBe(REDACT_MASK)
    expect(out.passwordHash).toBe(REDACT_MASK)
    expect(out.token).toBe(REDACT_MASK)
    expect((out.nested as Record<string, unknown>).apiKey).toBe(REDACT_MASK)
    expect((out.nested as Record<string, unknown>).authorization).toBe(REDACT_MASK)
    expect(JSON.stringify(out)).not.toContain("Sup3r")
    expect(JSON.stringify(out)).not.toContain("argon2id")
  })

  it("递归数组与嵌套对象（含数组里的对象里的敏感字段）", () => {
    const out = redactAuditValue({
      list: [
        { name: "a", password: "p1" },
        [{ sessionToken: "st1" }, "rawPassword=qwerty"],
      ],
    }) as { list: [Record<string, unknown>, [Record<string, unknown>, string]] }
    expect(out.list[0].password).toBe(REDACT_MASK)
    expect(out.list[0].name).toBe("a")
    expect(out.list[1][0].sessionToken).toBe(REDACT_MASK)
    expect(out.list[1][1]).toBe(`rawPassword=${REDACT_MASK}`)
  })

  it("authorName 等普通字段不被误伤", () => {
    const out = redactAuditValue({ authorName: "张三", monkey: "see", keyName: "abc" }) as Record<string, unknown>
    expect(out.authorName).toBe("张三")
    expect(out.monkey).toBe("see")
    expect(out.keyName).toBe("abc")
  })

  it("null / undefined → null；标量保留", () => {
    expect(redactAuditValue(null)).toBeNull()
    expect(redactAuditValue(undefined)).toBeNull()
    const out = redactAuditValue({ n: 7, b: true, big: BigInt("9007199254740993") }) as Record<string, unknown>
    expect(out).toEqual({ n: 7, b: true, big: "9007199254740993" })
  })

  it("深度上限：超限层替换为截断标记", () => {
    let deep: Record<string, unknown> = { password: "x" }
    for (let i = 0; i < REDACT_DEPTH_LIMIT + 4; i++) deep = { wrap: deep }
    const json = JSON.stringify(redactAuditValue(deep))
    expect(json).toContain("超过最大深度")
    expect(json).not.toContain("x")
  })

  it("列表上限：超出 200 项截断并标注", () => {
    const out = redactAuditValue(Array.from({ length: 300 }, (_, i) => i)) as unknown[]
    expect(out.length).toBe(REDACT_LIST_LIMIT + 1)
    expect(out[REDACT_LIST_LIMIT]).toContain("共 300 项")
  })

  it("字符串长度上限：8192 + 截断标注", () => {
    const out = redactAuditValue("啊".repeat(REDACT_STRING_LIMIT + 100)) as string
    expect(out.length).toBeLessThanOrEqual(REDACT_STRING_LIMIT + 10)
    expect(out).toContain("已截断")
  })

  it("循环引用 → 标记（不抛错）", () => {
    const a: Record<string, unknown> = { name: "a" }
    a.self = a
    a.pwd = "leak"
    const out = redactAuditValue(a) as Record<string, unknown>
    expect(out.self).toBe("[循环引用]")
    expect(out.pwd).toBe(REDACT_MASK)
  })

  it("Buffer 显示为占位（不泄漏二进制）", () => {
    expect(redactAuditValue(Buffer.from("secret bytes"))).toBe("[binary 12B]")
  })

  it("fail-closed：脱敏自身抛错 → 占位对象，绝不回退原文", () => {
    const boom = {
      ok: 1,
      get explode(): unknown {
        throw new Error("getter 内部异常")
      },
    }
    const out = redactAuditValue(boom) as Record<string, unknown>
    expect(out).toEqual({ redacted: true, note: "脱敏失败，原值已隐藏" })
  })

  it("幂等：脱敏结果再脱敏不改变（读取时双保险不引入二次伤害）", () => {
    const once = redactAuditValue({ token: "abc", note: "password=hunter2", keep: "normal" })
    expect(redactAuditValue(once)).toEqual(once)
  })
})

describe("redactErrorText", () => {
  it("错误文本中的凭据被脱敏（errorSummary 读取兜底）", () => {
    const out = redactErrorText('ER_ACCESS_DENIED_ERROR password=root123456 token="live_abc" mysql://u:ppp@h/db')
    expect(out).toContain("ER_ACCESS_DENIED_ERROR")
    expect(out).not.toContain("root123456")
    expect(out).not.toContain("live_abc")
    expect(out).not.toContain(":ppp@")
  })

  it("超长错误截断到 maxLen", () => {
    const out = redactErrorText("E".repeat(9000), 2000)
    expect(out.length).toBeLessThanOrEqual(2000)
  })
})
