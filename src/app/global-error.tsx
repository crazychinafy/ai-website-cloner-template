'use client'
// P8-8：全局错误边界 —— root layout 自身取数（Header/SiteFooter/layout generateMetadata）失败时兜底。
// Next 用本组件替换整个根布局并以 **500** 响应；此时全局 CSS 不保证生效 → 自带内联样式。
// 同样解析 ContentSourceError 消息中的 32hex 请求编号（无则显示 digest）。
import { ContentError, parseContentRequestId } from '@/components/sites/facai8/ContentError'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const requestId = parseContentRequestId(error?.message) ?? error?.digest ?? null
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#f4f5f5', color: '#334155', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif" }}>
        <ContentError requestId={requestId} retry={retry} />
      </body>
    </html>
  )
}
