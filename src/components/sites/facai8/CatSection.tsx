'use client'
import { useEffect, useState } from 'react'
import type { CatNodeDto, LinkItemDto, TagDto } from '@/lib/facai8/content/types'
import { LinkCard, SkeletonCard } from './LinkCard'

export interface CatSectionData {
  cat: CatNodeDto
  own: LinkItemDto[]
  bySub: Record<string, LinkItemDto[]>
}

interface Props {
  data: CatSectionData
  expanded: boolean
  activeSubId: string | null
  onTab: (catId: string, subId: string) => void
  innerRef: (el: HTMLElement | null) => void
  tagsById: Record<string, TagDto>
}

// 首页分类区块：头部（图标+标题+子分类 tab）+ 卡片网格；折叠态 = 408px 占位
export function CatSection({ data, expanded, activeSubId, onTab, innerRef, tagsById }: Props) {
  const { cat } = data
  const hasKids = cat.children.length > 0
  const visible = hasKids ? (activeSubId ? data.bySub[activeSubId] : []) : data.own

  const icon = (cls: string, size: number) =>
    cls ? (
      <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={cls} style={{ fontSize: size, lineHeight: 1 }}></i>
      </span>
    ) : null

  return (
    <section id={`section-${cat.id}`} className="cat-section" ref={innerRef} data-catid={cat.id}>
      <div className="cat-header">
        <h4 className="cat-title">
          {icon(cat.icon, 18)}
          <span className="cat-title-text">{cat.name}</span>
        </h4>
        {hasKids && (
          <ul className="cat-tabs">
            {cat.children.map((c) => (
              <li
                key={c.id}
                data-tab-id={c.id}
                className={'cat-tab' + (activeSubId === c.id ? ' active' : ' ')}
                onClick={() => onTab(cat.id, c.id)}
              >
                {icon(c.icon, 16)}
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {expanded ? (
        <CatGrid key={activeSubId ?? 'own'} visible={visible} tagsById={tagsById} />
      ) : (
        <div style={{ minHeight: 408 }}></div>
      )}
    </section>
  )
}

// 卡片网格（key 变化即重挂载 → 重播 源站展开/切 tab 动画序列：骨架→淡入→加 swapped）
function CatGrid({ visible, tagsById }: { visible: LinkItemDto[]; tagsById: Record<string, TagDto> }) {
  const [phase, setPhase] = useState<'skeleton' | 'ready'>('skeleton')
  const [swapped, setSwapped] = useState(false)
  const [switching, setSwitching] = useState(true)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('ready'), 260)
    const t2 = setTimeout(() => {
      setSwitching(false)
      setSwapped(true)
    }, 420)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  const gridCls = 'link-container grid' + (swapped ? ' swapped' : '') + (switching ? ' switching' : '')

  return (
    <div className={gridCls}>
      {phase === 'skeleton'
        ? Array.from({ length: Math.min(8, Math.max(4, visible.length)) }, (_, i) => <SkeletonCard key={i} />)
        : visible.map((l) => <LinkCard key={l.id} l={l} tagsById={tagsById} />)}
    </div>
  )
}
