'use client'
import { useState } from 'react'
import { MpEmpty, MpFilters, MpHero } from './MpBits'

// 源站 /my-comments（bi）1:1：mp-hero（💬 我的评论 + 计数）+ 状态过滤（全部/已通过/审核中/已拒绝）+ 空态。
// 测试账号 0 评论 → 恒空态（真实态）；过滤切换改空态文案（暂无评论 / 暂无该状态的评论）。

const FILTERS = [
  { k: 'ALL', v: '全部' },
  { k: '0', v: '已通过' },
  { k: '1', v: '审核中' },
  { k: '2', v: '已拒绝' },
]

export function MyComments() {
  const [filter, setFilter] = useState('ALL')
  return (
    <>
      <MpHero title="💬 我的评论" sub="你发表的评论及审核进度都在这里" count={0} countSuffix="条评论" />
      <MpFilters filters={FILTERS} active={filter} onFilter={setFilter} />
      <MpEmpty
        icon="💬"
        title={filter === 'ALL' ? '暂无评论' : '暂无该状态的评论'}
        sub="去文章或网址下方发表你的看法吧"
        to="/"
        linkLabel="🏠 去首页逛逛"
      />
    </>
  )
}
