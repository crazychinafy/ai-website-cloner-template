import Link from 'next/link'
import type { LinkItemDto, TagDto } from '@/lib/facai8/content/types'
import { asset, firstChar, gstaticFavicon } from '@/lib/facai8/util'

// 站点卡片（.link-card）——源站共享 `l` 组件 1:1：
//  logo 回退字 + (有 logo 时) 模糊底 + 图，悬停揭示；标题 + 描述；外部直达按钮(.link-goto)。
//  isGone：卡片底 #fafafa + 红「已关站」角标(Kn) + 详情链接 opacity .7 + 标题删除线灰 + 直达按钮禁用。
//  rating-badge：右上角标签图标圆徽（非失效 且 有标签 且 标签存在时）；tag 页源站此卡片不渲染该徽 → showRatingBadge=false。
//  注：本地 logo/favicon 均为已解析路径，源站 `j()/re()` 的「库id:字形」冒号语法解析在此不需要（归档即解析后类名）。
//  P8-4：标签徽标数据由服务端注入（tagsById = repo.getTags() 派生映射），组件不再读静态档案。
export function LinkCard({
  l,
  showRatingBadge = true,
  tagsById,
}: {
  l: LinkItemDto
  showRatingBadge?: boolean
  tagsById?: Record<string, TagDto>
}) {
  const gone = l.isGone === 1
  const tag = l.tagId ? (tagsById?.[l.tagId] ?? null) : null
  const logo = l.logoUrl ? asset(l.logoUrl) : null

  return (
    <div
      className="link-card"
      style={{ position: 'relative', ...(gone ? { background: '#fafafa' } : {}) }}
    >
      {/* 已关站角标（源站 Kn） */}
      {gone && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            fontSize: 10,
            color: '#fff',
            background: '#dc2626',
            padding: '1px 7px',
            borderRadius: '0 8px 0 6px',
            zIndex: 2,
            fontWeight: 600,
          }}
        >
          已关站
        </span>
      )}

      {/* 右上角标签图标圆徽（rating-badge） */}
      {!gone && showRatingBadge && tag && (
        <span
          className="rating-badge"
          data-tip={tag.name}
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            fontSize: 11,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: tag.bgColor,
            color: tag.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,.1)',
            cursor: 'default',
            zIndex: 1,
          }}
        >
          <i className={tag.icon} style={{ fontSize: 12, verticalAlign: 'middle' }} />
        </span>
      )}

      <Link
        href={`/link/${l.id}`}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: '1 1 0%',
          minWidth: 0,
          opacity: gone ? 0.7 : 1,
        }}
      >
        <div className="link-logo-wrap">
          <span className="link-logo link-logo-fallback" aria-hidden="true">
            {firstChar(l.title)}
          </span>
          {l.logoUrl && logo ? (
            <>
              <div className="link-logo-blur" style={{ backgroundImage: `url(${logo})` }} />
              <img
                src={logo}
                alt={l.title}
                className="link-logo link-logo-top"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const prev = e.currentTarget.previousElementSibling as HTMLElement | null
                  if (prev) prev.style.display = 'none'
                }}
              />
            </>
          ) : (
            <img
              src={gstaticFavicon(l.url)}
              alt=""
              className="link-logo link-logo-top"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
        </div>
        <div className="link-info">
          <span className="link-title" style={gone ? { textDecoration: 'line-through', color: '#bbb' } : {}}>
            {l.title}
          </span>
          {l.description && <span className="link-desc">{l.description}</span>}
        </div>
      </Link>

      <a
        href={l.url}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="link-goto"
        data-tip="直达"
        style={gone ? { opacity: 0.3, pointerEvents: 'none' } : {}}
        onClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6"></path>
        </svg>
      </a>
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="link-card skeleton-card" style={{ position: 'relative' }}>
      <div className="link-logo-wrap">
        <span className="link-logo link-logo-fallback" aria-hidden="true"></span>
      </div>
      <div className="link-info">
        <span className="link-title" style={{ background: '#e8eaee', color: 'transparent' }}>
          站点名称
        </span>
        <span className="link-desc" style={{ background: '#e8eaee', color: 'transparent' }}>
          描述
        </span>
      </div>
    </div>
  )
}
