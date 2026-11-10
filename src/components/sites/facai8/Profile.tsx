'use client'
import { useRef, useState } from 'react'
import { toast } from './Toast'

// 源站 /profile（mi）1:1：pf-hero（头像 + 昵称 + @用户名 + 注册/联系方式 chips）+ pf-stats（3 卡）
// + 2 个 pf-section（🔒 修改密码 / 📇 我的联系方式，默认折叠）。
// 数据 = 会话（username/avatar）+ 测试账号零内容（0/4 联系方式、0/0/0 统计）= 真实态。
// 交互（换头像 / 改昵称 / 改密码 / 加联系方式）= 静态 mock：结构 1:1，提交仅 toast 无后端。
// 注：注册日期源站显示真实值；本地 mock 无 → 固定占位（见 REGISTERED_AT）。

const REGISTERED_AT = '2026/11/8' // mock 占位（源站为真实注册日）

const CONTACT_PRESETS = [
  { key: 'wechat', label: '微信', color: '#07c160', path: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' },
  { key: 'qq', label: 'QQ', color: '#12b7f5', path: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
  { key: 'email', label: '邮箱', color: '#f59e0b', path: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
  { key: 'tg', label: 'TG', color: '#29a9eb', path: 'M9.04 15.37l-.38 5.32c.54 0 .78-.23 1.06-.51l2.55-2.44 5.28 3.87c.97.53 1.66.26 1.92-.89L22.94 4.6c.31-1.42-.51-1.98-1.46-1.63L2.4 10.9c-1.39.54-1.37 1.32-.24 1.67l4.89 1.53L18.4 6.7c.53-.35 1.02-.16.62.19L9.04 15.37z' },
]

function EyeInput({
  type,
  value,
  placeholder,
  onValue,
}: {
  type: 'password' | 'text'
  value: string
  placeholder: string
  onValue: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="pf-pwd-wrap">
      <input
        type={show ? 'text' : type}
        value={value}
        maxLength={50}
        placeholder={placeholder}
        className="pf-input"
        style={type === 'password' ? { paddingRight: 40 } : undefined}
        onChange={(e) => onValue(e.target.value)}
      />
      {type === 'password' && (
        <button type="button" className="pf-pwd-eye" title="显示密码" onClick={() => setShow((s) => !s)}>
          {show ? '🙈' : '👁️'}
        </button>
      )}
    </div>
  )
}

export function Profile({ username, avatar }: { username: string; avatar: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [nickEditing, setNickEditing] = useState(false)
  const [nick, setNick] = useState(username)
  const [nickSaving, setNickSaving] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [visOn, setVisOn] = useState(false)
  const [pwd, setPwd] = useState({ old: '', next: '', confirm: '', code: '' })
  const [preset, setPreset] = useState<string | null>(null)
  const [contact, setContact] = useState('')

  const initial = (nick || username || '?').charAt(0).toUpperCase()

  // 源站 Le：POST 改昵称（保存中… 禁用态）；本地 mock 仅 toast，不落库
  const saveNick = async () => {
    if (nickSaving) return
    setNickSaving(true)
    await new Promise((r) => setTimeout(r, 500))
    setNickSaving(false)
    setNickEditing(false)
    toast('昵称修改为演示功能', 'info')
  }

  return (
    <>
      {/* hero */}
      <div className="pf-hero">
        <div
          className="pf-avatar"
          title="点击更换头像"
          style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
          onClick={() => !nickEditing && fileRef.current?.click()}
        >
          {avatar ? (
            <img src={avatar} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            initial
          )}
          <span className="pf-avatar-mask">📷 换头像</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={() => toast('头像更换为演示功能', 'info')}
          />
        </div>
        <div style={{ flex: '1 1 0%', minWidth: 0 }}>
          {nickEditing ? (
            <h2 className="pf-name">
              <input
                autoFocus
                className="pf-nick-input"
                value={nick}
                maxLength={20}
                onChange={(e) => setNick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNick()
                }}
              />
              <span className={`comment-char-count pf-nick-count${nick.length >= 20 ? ' full' : ''}`}>
                {nick.length}/20
              </span>
              <button type="button" className="pf-btn-white" disabled={nickSaving} onClick={() => void saveNick()}>
                {nickSaving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className="pf-btn-glass"
                onClick={() => {
                  setNick(username)
                  setNickEditing(false)
                }}
              >
                取消
              </button>
            </h2>
          ) : (
            <h2 className="pf-name">
              {nick}
              <button type="button" className="pf-name-edit" title="编辑昵称" onClick={() => setNickEditing(true)}>
                ✎ 编辑
              </button>
            </h2>
          )}
          <p className="pf-username">@ {username}</p>
          <div className="pf-chips">
            <span className="pf-chip">🕐 注册于 {REGISTERED_AT}</span>
            <span className="pf-chip">📇 0/4 条联系方式</span>
          </div>
        </div>
      </div>

      {/* 统计 */}
      <div className="pf-stats">
        <div className="pf-stat">
          <div className="pf-stat-icon" style={{ background: '#f0f7ff' }}>⭐</div>
          <div style={{ minWidth: 0 }}>
            <div className="pf-stat-num">0</div>
            <div className="pf-stat-label">网址收藏</div>
          </div>
        </div>
        <div className="pf-stat">
          <div className="pf-stat-icon" style={{ background: '#eff6ff' }}>💬</div>
          <div style={{ minWidth: 0 }}>
            <div className="pf-stat-num">0/0</div>
            <div className="pf-stat-label">评论（通过/总数）</div>
          </div>
        </div>
        <div className="pf-stat">
          <div className="pf-stat-icon" style={{ background: '#f0fdf4' }}>📝</div>
          <div style={{ minWidth: 0 }}>
            <div className="pf-stat-num">0</div>
            <div className="pf-stat-label">投稿文章</div>
          </div>
        </div>
      </div>

      {/* 修改密码 */}
      <div className="pf-section">
        <div className="pf-section-head" onClick={() => setPwdOpen((o) => !o)}>
          <span className="pf-section-title">
            <span className="pf-section-title-icon" style={{ background: '#fef3c7' }}>🔒</span>修改密码
          </span>
          <span className={`pf-section-arrow ${pwdOpen ? 'open' : ''}`}>▼</span>
        </div>
        <div className={`pf-collapse ${pwdOpen ? 'open' : ''}`}>
          <div className="pf-collapse-inner">
            <div className="pf-section-body pf-pwd-form">
              <div className="pf-field">
                <label className="pf-label">旧密码</label>
                <EyeInput type="password" value={pwd.old} placeholder="请输入当前使用的密码" onValue={(v) => setPwd({ ...pwd, old: v })} />
              </div>
              <div className="pf-field">
                <label className="pf-label">新密码</label>
                <EyeInput type="password" value={pwd.next} placeholder="8-50 位，字母 / 数字 / 常用符号" onValue={(v) => setPwd({ ...pwd, next: v })} />
              </div>
              <div className="pf-field">
                <label className="pf-label">确认新密码</label>
                <EyeInput type="password" value={pwd.confirm} placeholder="请再次输入新密码" onValue={(v) => setPwd({ ...pwd, confirm: v })} />
              </div>
              <div className="pf-field">
                <label className="pf-label">邮箱验证码</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="6 位数字验证码"
                    className="pf-input"
                    style={{ flex: '1 1 0%', minWidth: 0 }}
                    value={pwd.code}
                    onChange={(e) => setPwd({ ...pwd, code: e.target.value.replace(/\D/g, '') })}
                  />
                  <button type="button" className="pf-btn-code" onClick={() => toast('验证码发送为演示功能', 'info')}>
                    发送验证码
                  </button>
                </div>
                <div className="pf-hint">验证码将发送到当前账号绑定的邮箱，5 分钟内有效</div>
              </div>
              <button type="button" className="pf-btn-primary pf-pwd-submit" onClick={() => toast('修改密码为演示功能', 'info')}>
                确认修改密码
              </button>
              <div className="pf-hint" style={{ textAlign: 'center', marginTop: -4 }}>
                修改成功后需要重新登录
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 联系方式 */}
      <div className="pf-section">
        <div className="pf-section-head" onClick={() => setContactOpen((o) => !o)}>
          <span className="pf-section-title">
            <span className="pf-section-title-icon" style={{ background: '#f0f7ff' }}>📇</span>我的联系方式
            <span className={`pf-badge ${visOn ? 'full' : ''}`}>0/4</span>
          </span>
          <span className={`pf-section-arrow ${contactOpen ? 'open' : ''}`}>▼</span>
        </div>
        <div className={`pf-collapse ${contactOpen ? 'open' : ''}`}>
          <div className="pf-collapse-inner">
            <div className="pf-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="pf-vis-row">
                <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>在资料页展示联系方式</div>
                  <div style={{ fontSize: 12, color: '#8a919f', marginTop: 2 }}>
                    {visOn ? '已展示：其他用户查看你的资料页时可见联系方式' : '已隐藏：其他用户查看你的资料页时看不到联系方式'}
                  </div>
                </div>
                <button
                  type="button"
                  className={`pf-switch ${visOn ? 'on' : ''}`}
                  role="switch"
                  aria-checked={visOn}
                  title={visOn ? '点击隐藏' : '点击恢复展示'}
                  onClick={() => setVisOn((v) => !v)}
                >
                  <span className="pf-switch-dot" />
                </button>
              </div>
              <div className="pf-empty">
                <div style={{ fontSize: 28, marginBottom: 6 }}>📇</div>
                <div style={{ fontSize: 13, color: '#8a919f' }}>还没有联系方式，在下方添加一条吧</div>
              </div>
              <div className="pf-addbox">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {CONTACT_PRESETS.map((p) => (
                    <button key={p.key} type="button" title="" className={`pf-chip-preset ${preset === p.key ? 'active' : ''}`} onClick={() => setPreset(p.key)}>
                      <svg viewBox="0 0 24 24" fill={p.color} width="14" height="14">
                        <path d={p.path} />
                      </svg>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                    <input
                      maxLength={50}
                      placeholder="先点选上方类型，再填写号码"
                      className="pf-input"
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13 }}
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    />
                    <div className="pf-char-hint">{contact.length}/50</div>
                  </div>
                  <button
                    type="button"
                    className="pf-btn-primary"
                    style={{ padding: '10px 18px', fontSize: 13, flexShrink: 0, alignSelf: 'flex-start' }}
                    onClick={() => toast('添加联系方式为演示功能', 'info')}
                  >
                    ＋ 添加
                  </button>
                </div>
                <div className="pf-secure-note">🔒 号码加密存储，仅自己可见</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
