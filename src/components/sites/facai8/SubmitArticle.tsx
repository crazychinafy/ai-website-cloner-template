'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from './Toast'
import { Truncate } from './Truncate'
import { n as WEditor, t as WToolbar, type WangeditorEditor } from '@/vendor/wangeditor/wangeditor'
import '@/vendor/wangeditor/wangeditor.css'

// 源站 /submit-article（懒加载 SubmitArticle chunk 1:1 复刻）：
// 双标签（提交文章/提交网址）+ wangeditor 富文本 + 分类组合框 + 校验/toast；
// 本地适配：认证态来自会话（源站 localStorage token）、
// P8-4：分类由页面层从 repo.getArticleCategories()/getHomeCategories() 注入（旧 data/ 值导入已废除）、
// 图片上传/提交/编辑读取按静态决策 mock（源站动作不落地）。

type TabKey = 'article' | 'link'

const MAX_IMG_SIZE = 5 * 1024 * 1024
const MAX_IMG_COUNT = 20
const MAX_CONTENT_LEN = 10000

/** 源站 `w(html)`：清理 wangeditor 冗余属性；空段落序列归零 */
function cleanHtml(html: string): string {
  const t = (html || '')
    .replace(/ style="width: auto;"/gi, '')
    .replace(/ colSpan="1"/gi, '')
    .replace(/ rowSpan="1"/gi, '')
    .replace(/ width="auto"/gi, '')
    .replace(/ data-href=""/gi, '')
    .replace(/ style=""/gi, '')
  return /^(<p>(<br\s*\/?\s*>)?<\/p>)+$/i.test(t.replace(/\s+/g, '')) ? '' : t
}

/** 源站 `Wn`：DOMParser 纯文本长度（SSR 期无 DOMParser → 0） */
function textLen(html: string): number {
  if (!html || typeof document === 'undefined') return 0
  return new DOMParser().parseFromString(html, 'text/html').body.textContent.length
}

export interface FlatCat {
  id: string
  name: string
}

// 源站 o()/e() 两个分类端点的本地档案等价（flatten 规则与源站一致：
// 文章 = 仅叶子；网址 = 父级 + 子级）。P8-4：flatten 移至页面层，分类 DTO 随 props 注入。

// ─── 富文本编辑器（源站 `ee` 1:1）──────────────────────────────
function RichEditor({ value, onChange, maxLength }: { value: string; onChange: (v: string) => void; maxLength: number }) {
  const [editor, setEditor] = useState<WangeditorEditor | null>(null)
  const editorRef = useRef<WangeditorEditor | null>(null)

  // 源站：值变化且与编辑器内容不一致 → 回灌（防外部重置）
  useEffect(() => {
    if (editor && value !== undefined && cleanHtml(editor.getHtml()) !== value) editor.setHtml(value || '')
  }, [editor, value])
  // 卸载/重建时销毁（1:1 源站 ee：清理闭包读渲染时状态，勿用 ref——
  // setEditor 触发旧清理拆掉时 ref 已指向新实例，会误销毁新编辑器）
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy()
        setEditor(null)
      }
    }
  }, [editor])

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
      <WToolbar
        editor={editor}
        defaultConfig={{ excludeKeys: ['group-video'] }}
        mode="simple"
        style={{ borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}
      />
      <WEditor
        defaultConfig={{
          placeholder: '请输入内容...',
          ...(maxLength ? { maxLength } : {}),
          onChange: (e: unknown) => {
            const ed = e as unknown as { getHtml: () => string }
            onChange(cleanHtml(ed.getHtml()))
          },
          MENU_CONF: {
            uploadImage: {
              // 本地静态决策：无上传接口 → objectURL 模拟（源站: await 上传接口 → data.url）
              async customUpload(file: File, insert: (url: string, alt: string, href: string) => void) {
                if (!file.type.startsWith('image/')) return toast('只能插入图片文件', 'error')
                if (file.size > MAX_IMG_SIZE) return toast('单张图片不能超过 5MB', 'error')
                if (((editorRef.current?.getHtml() || '').match(/<img/g) || []).length + 1 > MAX_IMG_COUNT)
                  return toast(`正文图片最多 ${MAX_IMG_COUNT} 张`, 'error')
                const url = URL.createObjectURL(file)
                insert(url, file.name, url)
              },
            },
          },
        }}
        mode="simple"
        onCreated={(e) => {
          editorRef.current = e
          setEditor(e)
        }}
        style={{ height: 300, overflowY: 'hidden' }}
      />
    </div>
  )
}

// ─── 校验错误行（源站 `T` 1:1）─────────────────────────────────
function Err({ children }: { children: ReactNode }) {
  return (
    <div className="submit-err">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

// ─── 分类组合框（源站 `te` 1:1：触发器 + 搜索过滤 + 下拉列表 + 方向自适应）──
function CatSelect({
  categories,
  value,
  onChange,
  error,
}: {
  categories: FlatCat[]
  value: string
  onChange: (id: string) => void
  error: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [up, setUp] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    []
  )

  const selected = categories.find((c) => c.id == value)
  const query = q.trim().toLowerCase()
  const list = categories.filter((c) => !query || c.name.toLowerCase().includes(query))
  const hl = (name: string): ReactNode => {
    if (!query) return name
    const i = name.toLowerCase().indexOf(query)
    if (i < 0) return name
    return (
      <>
        {name.slice(0, i)}
        <mark>{name.slice(i, i + query.length)}</mark>
        {name.slice(i + query.length)}
      </>
    )
  }
  const toggle = () => {
    if (!open) {
      const e = rootRef.current?.getBoundingClientRect()
      const page = rootRef.current?.closest('.submit-page')?.getBoundingClientRect()
      if (e) {
        const space = Math.min(window.innerHeight, page?.bottom ?? 1 / 0) - e.bottom
        setUp(space < 290 && e.top > 290)
      }
    }
    setOpen(!open)
  }
  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQ('')
  }

  return (
    <div
      ref={rootRef}
      className={`cat-select ${open ? 'open' : ''} ${error ? 'error' : ''}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          if (closeTimer.current) clearTimeout(closeTimer.current)
          closeTimer.current = setTimeout(() => setOpen(false), 150)
        }
      }}
    >
      <div className={`cat-select-trigger ${selected ? 'has-value' : ''}`} onClick={toggle}>
        <Truncate tag="span" className="cat-select-trigger-text" text={selected ? selected.name : ''}>
          {selected ? selected.name : '选择分类...'}
        </Truncate>
        <span className="cat-select-icons">
          {selected && (
            <button
              type="button"
              className="cat-select-clear"
              title="清除选择"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
            >
              ×
            </button>
          )}
          <span className="cat-select-arrow">▼</span>
        </span>
      </div>
      {open && (
        <div className={`cat-select-dropdown ${up ? 'up' : ''}`}>
          <div className="cat-select-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索分类名称..."
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="cat-select-list">
            {list.length === 0 ? (
              <div className="cat-select-empty">
                <span className="cat-select-empty-icon">🗂️</span>
                没有匹配「{q.trim()}」的分类
              </div>
            ) : (
              list.map((c) => (
                <div key={c.id} className={`cat-select-item ${value == c.id ? 'active' : ''}`} onClick={() => pick(c.id)}>
                  <span>{hl(c.name)}</span>
                  {value == c.id && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 投稿页主体（源站 `E` 1:1）─────────────────────────────────
export function SubmitArticle({
  loggedIn,
  articleCats,
  linkCats,
}: {
  loggedIn: boolean
  articleCats: FlatCat[]
  linkCats: FlatCat[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const p: TabKey = sp.get('tab') === 'link' ? 'link' : 'article'
  const editId = sp.get('edit') || ''

  const enabled = !editId
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [catId, setCatId] = useState('')

  const [titleErr, setTitleErr] = useState('')
  const [catErr, setCatErr] = useState('')
  const [descErr, setDescErr] = useState('')
  const [urlErr, setUrlErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement | null>(null)

  // 源站 window.__hideBootLoader（本地无该全局，守卫调用保持 1:1 契约）
  useEffect(() => {
    const w = window as Window & { __hideBootLoader?: () => void }
    w.__hideBootLoader?.()
  }, [])

  // 源站：?edit 时拉取投稿回填；失败 → toast + 跳 /my-posts（本地静态：无投稿档案 → 恒失败）
  useEffect(() => {
    if (!editId) return
    const fail = new Error('投稿不存在或不可编辑')
    Promise.reject(fail)
      .catch((e: Error) => {
        toast(e.message || '投稿不存在或不可编辑', 'error')
        router.replace('/my-posts')
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  const J = p === 'article' ? 100 : 20
  const validateTitle = (v: string): string => {
    const t = v.trim()
    if (!t) return p === 'article' ? '请输入文章标题' : '请输入网站名称'
    if (t.length < 2 || t.length > J) return `标题长度需在 2-${J} 字之间`
    return ''
  }
  const validateDesc = (v: string): string => (v.trim().length > 30 ? '简介最长30字' : '')
  const validateUrl = (v: string): string => {
    const t = v.trim()
    if (!t) return '请输入网址'
    if (!/^https?:\/\/\S+$/.test(t)) return '网址需以 http:// 或 https:// 开头，且不能包含空格'
    if (t.length > 200) return '网址最长200字符'
    return ''
  }
  const contentLen = textLen(content)

  // 源站 re()：切标签更新 URL（?tab）并清空表单（仅未编辑态）
  const switchTab = (k: TabKey) => {
    if (editId) return
    router.replace(k === 'link' ? '/submit-article?tab=link' : '/submit-article')
    setTitle('')
    setCatErr('')
    setDescErr('')
    setUrlErr('')
    setUrl('')
  }
  const resetForm = () => {
    setTitle('')
    setContent('')
    setUrl('')
    setDesc('')
    setCatId('')
    setTitleErr('')
    setCatErr('')
    setDescErr('')
    setUrlErr('')
  }

  // 源站 ue()：校验 → 提交（本地静态决策：mock 成功，不落地数据）
  const submit = async () => {
    if (!loggedIn) return toast('请先登录', 'error')
    const te = validateTitle(title)
    const ce = catId ? '' : '请选择分类'
    setTitleErr(te)
    setCatErr(ce)
    if (te || ce) {
      if (te) titleRef.current?.focus()
      return
    }
    const t = title.trim()
    void t
    if (p === 'article') {
      const c = content.trim()
      if (!c) return toast('请输入内容', 'error')
      const len = textLen(c)
      const hasMedia = /<(img|table)[\s>]/i.test(c)
      if (len < 10 && !hasMedia) return toast('内容至少10个字', 'error')
      if (len > MAX_CONTENT_LEN) return toast(`内容过长（${len}字），最多${MAX_CONTENT_LEN}字`, 'error')
      const imgs = (c.match(/<img/g) || []).length
      if (imgs > 20) return toast(`正文图片最多20张，当前${imgs}张`, 'error')
    } else {
      const ue = validateUrl(url)
      setUrlErr(ue)
      const de = validateDesc(desc)
      setDescErr(de)
      if (ue || de) return
    }
    setSubmitting(true)
    try {
      // 源站：编辑态 s/c(id, payload)、新增 a/r(payload) → code 200
      // 本地静态：直接成功
      if (editId) {
        toast('修改已保存，审核通过后展示', 'success')
        router.push('/my-posts')
      } else {
        toast(p === 'article' ? '文章已提交，审核后显示' : '网址已提交，审核后显示', 'success')
        resetForm()
      }
    } catch (e) {
      toast((e as Error).message || '提交失败，请重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const cats = p === 'article' ? articleCats : linkCats

  return (
    <div className="submit-page">
      <div className="submit-blob" style={{ width: 480, height: 480, background: '#1e80ff', top: -120, left: -80 }} />
      <div className="submit-blob" style={{ width: 420, height: 420, background: '#4f9dff', bottom: -100, right: -60 }} />
      <div className="submit-blob" style={{ width: 260, height: 260, background: '#38bdf8', top: '45%', left: '8%', opacity: 0.35 }} />
      <div className="submit-card">
        <div className="submit-head">
          <div className="submit-head-icon">
            {p === 'article' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            )}
          </div>
          <div>
            <h1 className="submit-title">{editId ? '编辑投稿' : p === 'article' ? '发布文章' : '申请收录'}</h1>
            <p className="submit-subtitle">{editId ? '仅审核中的投稿可以修改' : p === 'article' ? '分享你的技术见解与经验' : '推荐优质网站，共建导航'}</p>
          </div>
        </div>

        {!loggedIn && (
          <div className="submit-tip">
            <span className="submit-tip-icon">🔐</span>
            <span className="submit-tip-text">
              请先 <a href="/login">登录</a> 后再提交内容
            </span>
            <span className="submit-tip-arrow">→</span>
          </div>
        )}

        {!editId && (
          <div className="submit-tabs">
            {(
              [
                {
                  key: 'article' as TabKey,
                  label: '提交文章',
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  ),
                },
                {
                  key: 'link' as TabKey,
                  label: '提交网址',
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0-7.07 7.07l1.71-1.71" />
                    </svg>
                  ),
                },
              ]
            ).map((t) => (
              <button key={t.key} type="button" className={`submit-tab ${p === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="submit-field">
          <div className="submit-label-row">
            <label className="submit-label">
              {p === 'article' ? '文章标题' : '网站名称'} <em>*</em>
            </label>
            <span className={`submit-counter ${title.trim().length > J ? 'over' : ''}`}>
              {title.trim().length}/{J}
            </span>
          </div>
          <input
            ref={titleRef}
            className={`submit-input ${titleErr ? 'error' : ''}`}
            value={title}
            maxLength={J}
            onChange={(e) => {
              setTitle(e.target.value)
              if (titleErr) setTitleErr(validateTitle(e.target.value))
            }}
            onBlur={() => {
              if (title.trim()) setTitleErr(validateTitle(title))
            }}
            placeholder={p === 'article' ? '输入文章标题' : '输入网站名称'}
          />
          {titleErr && <Err>{titleErr}</Err>}
        </div>

        {p === 'link' && (
          <>
            <div className="submit-field">
              <div className="submit-label-row">
                <label className="submit-label">
                  网址 URL <em>*</em>
                </label>
                <span className={`submit-counter ${url.trim().length > 200 ? 'over' : ''}`}>{url.trim().length}/200</span>
              </div>
              <input
                className={`submit-input mono ${urlErr ? 'error' : ''}`}
                value={url}
                maxLength={200}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (urlErr) setUrlErr(validateUrl(e.target.value))
                }}
                onBlur={() => {
                  if (url.trim()) setUrlErr(validateUrl(url))
                }}
                placeholder="https://..."
              />
              {urlErr && <Err>{urlErr}</Err>}
            </div>
            <div className="submit-field">
              <div className="submit-label-row">
                <label className="submit-label">网站描述</label>
                <span className={`submit-counter ${desc.trim().length > 30 ? 'over' : ''}`}>{desc.trim().length}/30</span>
              </div>
              <input
                className={`submit-input ${descErr ? 'error' : ''}`}
                value={desc}
                maxLength={30}
                onChange={(e) => {
                  setDesc(e.target.value)
                  if (descErr) setDescErr(validateDesc(e.target.value))
                }}
                placeholder="一句话介绍这个网站（选填）"
              />
              {descErr && <Err>{descErr}</Err>}
            </div>
          </>
        )}

        <div className="submit-field">
          <label className="submit-label">
            分类 <em>*</em>
          </label>
          <CatSelect categories={cats} value={catId} onChange={(id) => { setCatId(id); setCatErr('') }} error={catErr} />
          {catErr && <Err>{catErr}</Err>}
        </div>

        {p === 'article' && (
          <div className="submit-field">
            <div className="submit-label-row">
              <label className="submit-label">
                文章内容 <em>*</em>
              </label>
              <span className={`submit-counter ${contentLen > MAX_CONTENT_LEN ? 'over' : ''}`}>
                {contentLen}/{MAX_CONTENT_LEN}
              </span>
            </div>
            <RichEditor value={content} onChange={setContent} maxLength={MAX_CONTENT_LEN} />
            <p style={{ margin: '6px 2px 0', fontSize: 12, color: 'var(--text-3, #8a919f)' }}>
              10-10000字（纯文本，不含标签/图片）；单张图片不超过5MB，最多20张
            </p>
          </div>
        )}

        <button type="button" className="submit-btn" onClick={submit} disabled={submitting || !enabled}>
          <span>
            {!submitting && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
            )}
            {submitting ? '提交中...' : editId ? '保存修改' : p === 'article' ? '发布文章' : '提交网址'}
          </span>
        </button>
        <p className="submit-note">提交后需审核，审核通过后公开展示</p>
      </div>
    </div>
  )
}
