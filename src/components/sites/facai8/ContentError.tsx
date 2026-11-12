'use client'
import Link from 'next/link'

// P8-8：内容数据源故障错误视图（error.tsx / global-error.tsx 共用），视觉沿用源站 NotFound 组件语言。
// 展示 requestId：服务端 ContentSourceError 消息格式「…请求编号 <32hex>」→ 此处解析；
// 无编号时回退 Next 的 error.digest（同样可与服务端日志关联）。
export function parseContentRequestId(message: string | null | undefined): string | null {
  const m = /请求编号 ([0-9a-f]{32})/.exec(String(message || ''))
  return m ? m[1] : null
}

export function ContentError({ requestId, retry }: { requestId?: string | null; retry?: () => void }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '80px 20px',
        maxWidth: 520,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div
        style={{
          fontSize: 72,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #fff4f0 0%, #f8ecef 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(255,90,60,.08)',
        }}
      >
        🛠️
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#252933', margin: 0 }}>服务暂时不可用</h1>
      <p style={{ fontSize: 14, color: '#8a919f', margin: 0, lineHeight: 1.8, maxWidth: 340 }}>
        内容数据服务暂时无法响应，请稍后重试。如持续出现，请凭下方请求编号联系管理员。
      </p>
      {requestId ? (
        <p
          style={{
            fontSize: 12,
            color: '#64748b',
            margin: 0,
            background: '#f1f2f6',
            border: '1px solid #e2e5ec',
            borderRadius: 8,
            padding: '6px 12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            userSelect: 'all',
          }}
        >
          请求编号：{requestId}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <Link href="/" className="nf-btn nf-btn-primary">
          <span className="nf-btn-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </span>
          返回首页
        </Link>
        {retry ? (
          <button onClick={retry} className="nf-btn nf-btn-ghost">
            <span className="nf-btn-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </span>
            重试
          </button>
        ) : null}
      </div>
    </div>
  )
}
