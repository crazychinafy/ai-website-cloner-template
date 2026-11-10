'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_LINES, type LineItem } from '@/lib/facai8/data/lines'
import { displayUrl } from '@/lib/facai8/util'
import { Truncate } from './Truncate'

// 源站 /lines（懒加载 chunk LineCheck-gxh70Vm-.js，已存档 src-linecheck.js）本地等价：
// 5 线路卡 + Image favicon 测速（10s 超时）+ 延迟着色（<300 绿 / <1000 琥珀 / ≥1000 红 / 失败灰）
// + bar 宽 min(ms/15,100)% + 最快「推荐」 + 当前线路徽章（origin 匹配）+ 星空 canvas。
// 线路列表为静态数据（源站 GET /api/public/lines 快照）→ 无加载骨架/错误重试分支。

const PROBE_TIMEOUT = 10_000
const COPY_RESET = 1500

type Probe = { ok: boolean; ms: number | null }
type Results = Record<string, 'testing' | Probe>

/** 源站 p()：Image 加载 {url}/favicon.svg?_=ts，onload 计耗时 / onerror 或 10s 超时 = 失败 */
function probe(url: string): Promise<Probe> {
  return new Promise((resolve) => {
    const start = performance.now()
    const img = new Image()
    const timer = setTimeout(() => {
      img.onload = img.onerror = null
      resolve({ ok: false, ms: null })
    }, PROBE_TIMEOUT)
    img.onload = () => {
      clearTimeout(timer)
      resolve({ ok: true, ms: Math.round(performance.now() - start) })
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve({ ok: false, ms: null })
    }
    img.src = `${url}/favicon.svg?_=${Date.now()}`
  })
}

/** 源站 m()：null 灰 / <300 绿 / <1000 琥珀 / ≥1000 红 */
function latencyColor(ms: number | null): string {
  if (ms === null) return '#8a919f'
  if (ms < 300) return '#16a34a'
  if (ms < 1000) return '#d97706'
  return '#dc2626'
}

const STAR_COLORS = ['#1e80ff', '#3a8fff', '#22d3ee', '#8ec1fc']

interface Star {
  x: number
  y: number
  r: number
  speed: number
  sway: number
  swayAmp: number
  baseAlpha: number
  twinkle: number
  color: string
}

/** 源站星空 canvas：数量 min(70, max(30, 面积/26000))，上浮 + 正弦摇摆 + 闪烁（光晕 r*3 + 核 r） */
function useStars(canvasRef: React.RefObject<HTMLCanvasElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement
    const fit = () => {
      if (parent) {
        canvas.width = parent.offsetWidth
        canvas.height = parent.offsetHeight
      }
    }
    fit()
    window.addEventListener('resize', fit)
    const count = Math.min(70, Math.max(30, Math.floor((canvas.width * canvas.height) / 26000)))
    const stars: Star[] = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1 + Math.random() * 2.2,
      speed: 0.15 + Math.random() * 0.35,
      sway: Math.random() * Math.PI * 2,
      swayAmp: 0.2 + Math.random() * 0.4,
      baseAlpha: 0.15 + Math.random() * 0.3,
      twinkle: 0.8 + Math.random() * 1.6,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    }))
    let s = 0
    let raf = 0
    const tick = () => {
      s += 0.016
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const n of stars) {
        n.y -= n.speed
        n.x += Math.sin(s * n.swayAmp + n.sway) * 0.3
        if (n.y < -6) {
          n.y = canvas.height + 6
          n.x = Math.random() * canvas.width
        }
        const a = n.baseAlpha + Math.sin(s * n.twinkle + n.sway) * 0.12
        ctx.globalAlpha = a * 0.35
        ctx.fillStyle = n.color
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = Math.max(0.05, a)
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
    }
  }, [active, canvasRef])
}

export function Lines() {
  // 源站挂载即置 testing 再探测；本地初始 state 直接 = 全 testing（避免 effect 内同步 setState）
  const [results, setResults] = useState<Results>(() => {
    const n: Results = {}
    for (const l of ALL_LINES) n[l.id] = 'testing'
    return n
  })
  const [copied, setCopied] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  useStars(canvasRef, true)

  // 源站 W()：逐条并发探测（Image favicon，10s 超时）
  const probeAll = useCallback(() => {
    for (const l of ALL_LINES) {
      probe(l.url).then((r) => setResults((prev) => ({ ...prev, [l.id]: r })))
    }
  }, [])

  // 重新检测按钮：复位 testing + 重测
  const retest = useCallback(() => {
    const next: Results = {}
    for (const l of ALL_LINES) next[l.id] = 'testing'
    setResults(next)
    probeAll()
  }, [probeAll])

  useEffect(() => {
    probeAll()
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [probeAll])

  // 源站：复制 = clipboard（回退 textarea/execCommand）+ 1.5s copied 态
  const copy = async (ev: React.MouseEvent, l: LineItem) => {
    ev.stopPropagation()
    try {
      await navigator.clipboard.writeText(l.url)
    } catch {
      const el = document.createElement('textarea')
      el.value = l.url
      el.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(el)
      el.select()
      try {
        document.execCommand('copy')
      } catch {
        // 忽略
      }
      el.remove()
    }
    setCopied(l.id)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied((c) => (c === l.id ? null : c)), COPY_RESET)
  }

  // 源站：best = 探测成功中耗时最小者 → 「推荐」徽章
  const best = (() => {
    let id: string | null = null
    let min = Infinity
    for (const l of ALL_LINES) {
      const r = results[l.id]
      if (r && r !== 'testing' && r.ok && r.ms !== null && r.ms < min) {
        id = l.id
        min = r.ms
      }
    }
    return id
  })()

  const testing = Object.values(results).some((r) => r === 'testing')

  return (
    <div className="lc-page">
      <canvas ref={canvasRef} className="lc-stars" />
      <div className="lc-content">
        <div className="lc-hero">
          <h1 className="lc-title">线路检测</h1>
          <p className="lc-sub">如当前访问缓慢或无法打开，可切换到以下备用线路</p>
        </div>
        {ALL_LINES.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8a919f', padding: '40px 0' }}>暂无可用线路</div>
        ) : (
          <div className="lc-grid">
            {ALL_LINES.map((l, i) => {
              const r = results[l.id]
              const isCurrent = origin !== '' && origin === l.url
              const isDead = r !== undefined && r !== 'testing' && !r.ok
              return (
                <div
                  key={l.id}
                  className={`lc-card ${isCurrent ? 'current' : ''} ${isDead ? 'dead' : ''}`}
                  style={{ animationDelay: i * 80 + 'ms' }}
                  onClick={() => window.open(displayUrl(l.url), '_blank', 'noreferrer')}
                >
                  <span className={`lc-dot ${r === 'testing' ? 'testing' : r?.ok ? 'ok' : 'dead'}`}></span>
                  <div className="lc-main">
                    <div className="lc-name">
                      <Truncate tag="span" className="lc-name-text" text={l.name}></Truncate>
                      {isCurrent && <span className="lc-badge current">当前线路</span>}
                      {!isCurrent && l.id === best && <span className="lc-badge best">推荐</span>}
                    </div>
                    <Truncate className="lc-url" text={l.url}></Truncate>
                  </div>
                  <div className="lc-latency">
                    {r === 'testing' ? (
                      <span className="lc-ms" style={{ color: '#8a919f' }}>
                        检测中
                        <i className="lc-dots">
                          <i>.</i>
                          <i>.</i>
                          <i>.</i>
                        </i>
                      </span>
                    ) : r?.ok ? (
                      <>
                        <span className="lc-ms" style={{ color: latencyColor(r.ms) }}>
                          {r.ms}
                          <small>ms</small>
                        </span>
                        <div className="lc-bar">
                          <div
                            className="lc-bar-fill"
                            style={{ width: Math.min((r.ms ?? 0) / 15, 100) + '%', background: latencyColor(r.ms) }}
                          ></div>
                        </div>
                      </>
                    ) : (
                      <span className="lc-ms" style={{ color: '#8a919f' }}>
                        不可用
                      </span>
                    )}
                  </div>
                  <div className="lc-actions">
                    <button
                      className={`lc-btn-copy ${copied === l.id ? 'copied' : ''}`}
                      title={copied === l.id ? '已复制' : '复制链接'}
                      onClick={(e) => copy(e, l)}
                    >
                      {copied === l.id ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <button className="lc-retest" disabled={testing} onClick={() => retest()}>
            <svg
              className={testing ? 'lc-spin' : ''}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {testing ? '检测中...' : '重新检测'}
          </button>
        </div>
      </div>
    </div>
  )
}
