'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HOME_POPUP } from '@/lib/facai8/data/popup'

const HALO = '/sites/facai8/images/popup-halo.png'

// 首屏「重要通知」弹窗（源站结构：mask > wrap > halo(sprite) + card(head/content/foot/agreement)）
export function HomePopup() {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!HOME_POPUP.enabled) return
    const t = setTimeout(() => setShown(true), 350)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (open) document.body.classList.add('popup-open')
    else document.body.classList.remove('popup-open')
    return () => document.body.classList.remove('popup-open')
  }, [open])

  if (!shown || !open || !HOME_POPUP.enabled) return null

  return (
    <div className="home-popup-mask">
      <div className="home-popup-wrap">
        <div className="home-popup-halo sprite" style={{ backgroundImage: `url("${HALO}")` }}></div>
        <div className="home-popup-card">
          <div className="home-popup-head">
            <div className="home-popup-circle"></div>
            <div className="home-popup-circle"></div>
            <span className="home-popup-spark">✦</span>
            <span className="home-popup-spark">✦</span>
            <span className="home-popup-spark">✦</span>
            <span className="home-popup-spark">✦</span>
            <span className="home-popup-spark">✦</span>
            <div>
              <div className="home-popup-icon">📢</div>
              <div>{HOME_POPUP.title}</div>
              <button type="button" className="home-popup-close" onClick={() => setOpen(false)} aria-label="关闭">
                ✕
              </button>
            </div>
          </div>
          <div
            className="article-detail-content home-popup-content"
            dangerouslySetInnerHTML={{ __html: HOME_POPUP.content }}
          />
          <div className="home-popup-foot">
            <label className="home-popup-notoday">
              <input type="checkbox" />
              <span className="home-popup-checkbox">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M20 6 9 17l-5-5"></path>
                </svg>
              </span>
              今日不再弹出
            </label>
            <button type="button" className="home-popup-confirm" onClick={() => setOpen(false)}>
              确认进入
            </button>
          </div>
          <div className="home-popup-agreement">
            继续访问即表示你已阅读并同意
            <Link href="/agreement">《用户协议》</Link>与
            <Link href="/privacy">《隐私政策》</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
