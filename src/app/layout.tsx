import type { Metadata } from 'next'
import './globals.css'
import '@/components/sites/facai8/facai8.css'
import '@/components/sites/facai8/iconfont.css'
import { ToastHost } from '@/components/sites/facai8/Toast'
import { getContentRepository } from '@/lib/facai8/content/source'
import { asset } from '@/lib/facai8/util'

// P8-3/P8-6（第 5 组）：根 metadata（标题/描述/图标）改走 repo.getSiteSettings()（static/mysql 同源）。
// 站点路由全部 ƒ Dynamic（每请求 SSR）→ generateMetadata 每请求读取，无构建期内容缓存。
// 图标：settings.siteFavicon（源站 /uploads/... 路径）经 asset() 映射本地 public/sites/facai8/images/（与旧硬编码同值）。
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getContentRepository().getSiteSettings()
  return {
    title: settings.siteName,
    description: settings.siteDescription,
    icons: {
      icon: asset(settings.siteFavicon) ?? '/sites/facai8/images/15cdad5a02bb43e1a15e2e100517a332.png',
    },
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  )
}
