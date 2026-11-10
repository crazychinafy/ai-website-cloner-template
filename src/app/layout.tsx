import type { Metadata } from 'next'
import './globals.css'
import '@/components/sites/facai8/facai8.css'
import '@/components/sites/facai8/iconfont.css'
import { ToastHost } from '@/components/sites/facai8/Toast'
import { SITE_INFO } from '@/lib/facai8/data/site-info'

export const metadata: Metadata = {
  title: '彩搜搜',
  description: SITE_INFO.siteDescription,
  icons: {
    icon: '/sites/facai8/images/15cdad5a02bb43e1a15e2e100517a332.png',
  },
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
