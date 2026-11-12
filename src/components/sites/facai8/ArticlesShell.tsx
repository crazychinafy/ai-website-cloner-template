'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ArticleCategoryDto, ArticleDto } from '@/lib/facai8/content/types'
import type { CatNode } from '@/lib/facai8/data/categories'
import { SideNav } from './SideNav'
import { ArtCard, ArticlesPager } from './ArtCard'
import { MobileCatDrawer } from './MobileBar'

const PAGE_SIZE = 18

interface Props {
  cats: ArticleCategoryDto[]
  activeId: string
  articles: ArticleDto[]
}

// 文章列表页：左栏「文章分类」+ 3 列卡片网格 + 分页（源站分页纯客户端状态）
export function ArticlesShell({ cats, activeId, articles }: Props) {
  const router = useRouter()
  const active = cats.find((c) => c.id === activeId) ?? cats[0]

  const nodes = useMemo<CatNode[]>(
    () => cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder, children: [] })),
    [cats]
  )

  const pick = (catId: string) => {
    router.push(`/articles?category=${catId}`)
  }

  return (
    <div className="main-layout">
      <MobileCatDrawer cats={nodes} title="文章分类" articleMode activeId={active.id} onPick={pick} />
      <SideNav cats={nodes} title="文章分类" activeId={active.id} className="articles-sidebar" hrefFor={(id) => `/articles?category=${id}`} />
      <main className="content flip-fill articles-main">
        <div className="articles-head">
          <h2 className="articles-title">
            <span className="articles-title-text">{active.name}</span>
          </h2>
          {articles.length > 0 && <span className="articles-count">共 {articles.length} 篇</span>}
        </div>
        <ArticlesGrid key={active.id} activeName={active.name} articles={articles} onOtherCats={() => pick(cats[0].id)} />
      </main>
    </div>
  )
}

// 网格 + 分页（key=分类 → 切分类回第 1 页，与源站客户端分页行为一致）
function ArticlesGrid({
  activeName,
  articles,
  onOtherCats,
}: {
  activeName: string
  articles: ArticleDto[]
  onOtherCats: () => void
}) {
  const [page, setPage] = useState(1)
  const total = articles.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = articles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="side-flip-wrap">
        <div className="articles-grid">
          {items.map((a) => (
            <ArtCard key={a.id} a={a} />
          ))}
          {total === 0 && (
            <div className="up-empty">
              <div className="up-empty-icon">📭</div>
              <div className="up-empty-title">「{activeName}」分类暂无文章</div>
              <div className="up-empty-sub">换个分类看看，说不定有惊喜</div>
              <a className="up-empty-link" style={{ cursor: 'pointer' }} onClick={onOtherCats}>
                📚 看看其他分类
              </a>
            </div>
          )}
        </div>
      </div>
      {totalPages > 1 && <ArticlesPager page={page} totalPages={totalPages} onGo={setPage} />}
    </>
  )
}
