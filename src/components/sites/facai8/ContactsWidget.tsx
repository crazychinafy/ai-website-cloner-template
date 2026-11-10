'use client'
import { useState } from 'react'

// 联系我们卡片（点击展开/收起；源站当前无联系方式数据 → 空态提示）
export function ContactsWidget() {
  const [open, setOpen] = useState(false)
  return (
    <div className="widget-card widget-contacts">
      <div className="widget-head" onClick={() => setOpen((v) => !v)}>
        <span className="widget-icon widget-icon-violet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 14v-3a9 9 0 0 1 18 0v3"></path>
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"></path>
            <path d="M21 14h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z"></path>
          </svg>
        </span>
        <span className="widget-texts">
          <span className="widget-title">联系我们</span>
          <span className="widget-sub">{open ? '点击收起' : '点击展开查看'}</span>
        </span>
        <svg className={'widget-arrow' + (open ? ' open' : ' ')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </div>
      <div className={'contact-list-wrap' + (open ? ' open' : ' ')}>
        <div className="contact-list">
          <p className="no-data">暂无联系方式</p>
        </div>
      </div>
    </div>
  )
}
