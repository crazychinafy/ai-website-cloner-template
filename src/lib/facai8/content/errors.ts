// P8-8：内容数据源故障 → 显式 5xx（不静默回退静态数据）
// 任何 Content Repository 方法抛错（MySQL 不可用 / 查询失败 / 表缺失等）都会被包成
// ContentSourceError：固定消息格式（请求编号 32hex）→ error.tsx / global-error.tsx 边界
// 在 SSR 下渲染 500 页面时能解析出 requestId；服务端日志同 id 可关联原始错误。
// 注意：消息只含数据源名与请求编号，不含 SQL / 凭据 / 连接串（防泄漏）。
import "server-only"
import { randomUUID } from "crypto"

/** 请求编号：uuidv4 去连字符（32 hex），前端展示 + 服务端日志关联用 */
export function newRequestId(): string {
  return randomUUID().replace(/-/g, "")
}

export class ContentSourceError extends Error {
  /** 32 位十六进制请求编号（服务端日志与错误页均可见） */
  readonly requestId: string
  /** 出错的数据源（mysql 被选择但库不可用时绝不回退 static） */
  readonly source: "static" | "mysql"
  /** 出错的仓库方法名（仅入服务端日志，不上消息） */
  readonly method: string

  constructor(source: "static" | "mysql", method: string, cause?: unknown) {
    const requestId = newRequestId()
    super(`内容数据服务暂时不可用（${source}），请求编号 ${requestId}`, { cause })
    this.name = "ContentSourceError"
    this.requestId = requestId
    this.source = source
    this.method = method
  }
}
