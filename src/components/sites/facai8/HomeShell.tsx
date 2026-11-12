'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdDto,
  BulletinDto,
  CatNodeDto,
  LinkItemDto,
  MiniArticleDto,
  MiniLinkDto,
  SiteSettingsDto,
  TagDto,
} from '@/lib/facai8/content/types'
import { SideNav } from './SideNav'
import { CatSection, type CatSectionData } from './CatSection'
import { HomeRail } from './HomeRail'
import { Bulletins } from './Bulletins'
import { AdPromo } from './AdPromo'
import { MobileCatDrawer } from './MobileBar'

interface Props {
  cats: CatNodeDto[]
  linksByCategory: Record<string, LinkItemDto[]>
  bulletins: BulletinDto[]
  ads: AdDto[]
  stats: SiteSettingsDto['stats']
  newLinks: MiniLinkDto[]
  newArticles: MiniArticleDto[]
  recentLinks: MiniLinkDto[]
  tagsById: Record<string, TagDto>
}

// 首页三栏客户端壳：左栏导航 ↔ 分类区块 联动（滚动/展开/切 tab）
// P8-4：全部首屏数据（公告/广告/统计/最新收录/最新文章/最近更新/标签映射）由页面（服务端仓库）注入。
export function HomeShell({
  cats,
  linksByCategory,
  bulletins,
  ads,
  stats,
  newLinks,
  newArticles,
  recentLinks,
  tagsById,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(cats.slice(0, 3).map((c) => c.id))
  )
  const [activeSubs, setActiveSubs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const c of cats) if (c.children.length) m[c.id] = c.children[0].id
    return m
  })
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [tick] = useState(0)

  const onEnter = useCallback((catId: string) => {
    setExpanded((prev) => {
      if (prev.has(catId)) return prev
      const n = new Set(prev)
      n.add(catId)
      return n
    })
  }, [])

  // 懒展开：进入视口即展开（与源站一致）
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = (e.target as HTMLElement).dataset.catid
            if (id) onEnter(id)
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '200px 0px' }
    )
    for (const el of sectionRefs.current.values()) io.observe(el)
    return () => io.disconnect()
  }, [onEnter, tick])

  const setTab = useCallback((catId: string, subId: string) => {
    setActiveSubs((m) => ({ ...m, [catId]: subId }))
  }, [])

  const pickFromSidebar = useCallback(
    (catId: string, subId?: string) => {
      setExpanded((prev) => {
        const n = new Set(prev)
        n.add(catId)
        return n
      })
      if (subId) setTab(catId, subId)
      // 等网格渲染后再滚动
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = sectionRefs.current.get(catId)
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 60)
      })
    },
    [setTab]
  )

  const sections = useMemo<CatSectionData[]>(
    () =>
      cats.map((cat) => {
        const bySub: Record<string, LinkItemDto[]> = {}
        for (const c of cat.children) bySub[c.id] = linksByCategory[c.id] || []
        return { cat, own: linksByCategory[cat.id] || [], bySub }
      }),
    [cats, linksByCategory]
  )

  return (
    <div className="main-layout">
      <MobileCatDrawer cats={cats} onPick={pickFromSidebar} />
      <SideNav cats={cats} title="网址分类" onPick={pickFromSidebar} />
      <main className="content home-content">
        <Bulletins items={bulletins} />
        <AdPromo ads={ads} />
        {sections.map((s) => (
          <CatSection
            key={s.cat.id}
            data={s}
            expanded={expanded.has(s.cat.id)}
            activeSubId={s.cat.children.length ? activeSubs[s.cat.id] ?? s.cat.children[0].id : null}
            onTab={setTab}
            tagsById={tagsById}
            innerRef={(el) => {
              if (el) {
                el.dataset.catid = s.cat.id
                sectionRefs.current.set(s.cat.id, el)
              } else {
                sectionRefs.current.delete(s.cat.id)
              }
            }}
          />
        ))}
      </main>
      <HomeRail stats={stats} newLinks={newLinks} newArticles={newArticles} recentLinks={recentLinks} />
    </div>
  )
}
