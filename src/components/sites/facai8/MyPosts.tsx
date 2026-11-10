'use client'
import { useState } from 'react'
import { MpEmpty, MpFilters, MpHero, MpTabs } from './MpBits'

// 源站 /my-posts（wi）1:1：mp-hero（📝 我的发布 + 网址/文章分段 + 计数）+ 状态过滤（全部/审核中/已发布/已删除）+ 空态。
// 测试账号 0 发布 → 恒空态（真实态）；分段 + 过滤切换改图标/文案；空态链接 → /submit-article（✏️ 去投稿）。

const FILTERS = [
  { k: 'ALL', v: '全部' },
  { k: '2', v: '审核中' },
  { k: '1', v: '已发布' },
  { k: '3', v: '已删除' },
]

export function MyPosts() {
  const [tab, setTab] = useState<'links' | 'articles'>('links')
  const [filter, setFilter] = useState('ALL')
  const unit = tab === 'links' ? '网址' : '文章'
  return (
    <>
      <MpHero
        title="📝 我的发布"
        sub={<>你提交的{unit}及审核进度都在这里</>}
        count={0}
        countSuffix={`条${unit}`}
        tabs={<MpTabs tab={tab} onTab={setTab} />}
      />
      <MpFilters filters={FILTERS} active={filter} onFilter={setFilter} />
      <MpEmpty
        icon={tab === 'links' ? '🌐' : '📄'}
        title={`暂无${filter === 'ALL' ? '' : '该状态的'}${unit}投稿`}
        sub={`提交的${unit}审核通过后会展示在站内`}
        to="/submit-article"
        linkLabel="✏️ 去投稿"
      />
    </>
  )
}
