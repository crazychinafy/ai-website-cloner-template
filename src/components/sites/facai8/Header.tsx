import Link from 'next/link'
import { SITE_INFO } from '@/lib/facai8/data/site-info'
import { ARTICLE_CATEGORIES } from '@/lib/facai8/data/article-categories'
import { asset, firstChar } from '@/lib/facai8/util'
import { AvatarMenu } from './AvatarMenu'
import type { SessionUser } from '@/lib/facai8/auth'

export function Header({ user }: { user: SessionUser | null }) {
  return (
    <header className="header">
      <div className="header-inner">
        <Link className="logo" href="/">
          <img alt={SITE_INFO.siteName} className="logo-img" src={asset(SITE_INFO.siteLogo) || '/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png'} />
          <span className="logo-text">{SITE_INFO.siteName}</span>
        </Link>
        <nav className="top-nav">
          {ARTICLE_CATEGORIES.map((c) => (
            <Link key={c.id} className="nav-link" href={`/articles?category=${c.id}`}>
              {c.icon && (
                <i
                  className={c.icon}
                  style={{ fontSize: 14, marginRight: 3, verticalAlign: 'middle' }}
                ></i>
              )}
              <span className="nav-link-text">{c.name}</span>
            </Link>
          ))}
        </nav>
        <div className="header-right">
          {user ? (
            <AvatarMenu
              user={{ username: user.username, avatar: user.avatar, initial: firstChar(user.username) }}
            />
          ) : (
            <Link className="btn-login" href="/login">
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
