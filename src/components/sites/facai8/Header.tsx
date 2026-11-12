import Link from 'next/link'
import { getContentRepository } from '@/lib/facai8/content/source'
import { asset, firstChar } from '@/lib/facai8/util'
import { AvatarMenu } from './AvatarMenu'
import type { SessionUser } from '@/lib/facai8/auth'

// P8-3：站点信息/文章分类导航改走统一内容仓库（server 组件，static/mysql 双源同形）。
export async function Header({ user }: { user: SessionUser | null }) {
  const repo = getContentRepository()
  const [settings, articleCategories] = await Promise.all([
    repo.getSiteSettings(),
    repo.getArticleCategories(),
  ])
  return (
    <header className="header">
      <div className="header-inner">
        <Link className="logo" href="/">
          <img alt={settings.siteName} className="logo-img" src={asset(settings.siteLogo) || '/sites/facai8/images/22bb856abdab4f4eae80039cee3b3365.png'} />
          <span className="logo-text">{settings.siteName}</span>
        </Link>
        <nav className="top-nav">
          {articleCategories.map((c) => (
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
