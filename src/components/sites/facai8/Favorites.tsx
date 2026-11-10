'use client'
import { useState } from 'react'
import { MpEmpty, MpHero, MpTabs } from './MpBits'

// 源站 /favorites（ii）1:1：mp-hero（⭐ 我的收藏 + 网址/文章分段 + 计数）+ 空态。
// 测试账号 0 收藏 → 恒空态（真实态）；分段切换改图标/文案，无列表内容（静态 mock）。

export function Favorites() {
  const [tab, setTab] = useState<'links' | 'articles'>('links')
  const unit = tab === 'links' ? '网址' : '文章'
  return (
    <>
      <MpHero
        title="⭐ 我的收藏"
        sub={<>你收藏的{unit}都在这里</>}
        count={0}
        countSuffix="个收藏"
        tabs={<MpTabs tab={tab} onTab={setTab} />}
      />
      <MpEmpty
        icon={tab === 'links' ? '🌐' : '📄'}
        title={`还没有收藏${unit}`}
        sub={`看到喜欢的${unit}点一下收藏就会出现在这里`}
        to="/"
        linkLabel="🏠 去首页逛逛"
      />
    </>
  )
}
