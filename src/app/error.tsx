'use client'
// P8-8：根段错误边界 —— SSR 中 page/generateMetadata 抛错（典型：CONTENT_SOURCE=mysql 但库不可用）
// → Next 以 **500** 状态渲染本页错误 UI（非回退静态内容的 200）。错误消息携带 32hex 请求编号
// （ContentSourceError 格式），展示给用户用于与日志关联；非内容源错误展示 Next digest。
// 说明：本边界覆盖根段 page + 所有无自有边界的子路由；root layout 自身（Header/SiteFooter）
// 的取数错误由 global-error.tsx 兜底（同一 ContentSourceError 语义）。
import { ContentError, parseContentRequestId } from '@/components/sites/facai8/ContentError'

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const requestId = parseContentRequestId(error?.message) ?? error?.digest ?? null
  return <ContentError requestId={requestId} retry={retry} />
}
