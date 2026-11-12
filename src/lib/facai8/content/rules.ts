// P8-1：前台内容规则纯函数 —— 搜索 / 相关推荐 / 摘要的业务规则下沉到内容层，
// 由 StaticSnapshotRepository 与 MySqlRepository 共用同一份代码，保证「双数据源规则恒等」（§9）。
// 本模块不含任何数据/DB import：纯函数，客户端 bundle、Node 脚本、vitest 均可直接加载。
// 语义与 src/lib/facai8/util.ts 的既有实现逐位一致（util.ts 现从这里 re-export，单一实现源）。

/** 文章正文 → 搜索摘要：源站后端去标签（不压空白，换行原样保留），>100 取前 100 + 「…」 */
export function articleExcerpt(html: string): string {
  const s = String(html || "").replace(/<[^>]+>/g, "")
  return s.length > 100 ? s.slice(0, 100) + "…" : s
}

/** 搜索匹配谓词（源站实测语义：标题/正文字串包含，忽略大小写，不折叠音阶 —— JS toLowerCase 基准） */
export function searchHit(haystack: string, needleLower: string): boolean {
  return haystack.toLowerCase().includes(needleLower)
}

/** 相关推荐候选（链接侧）：item + 点击数；「未失效」过滤由调用方预先完成（两侧同一 WHERE/谓词） */
export interface RelatedLinkCandidate<T> {
  item: T
  clicks: number
}

/**
 * 文章详情「相关网址」（源站规则，= util.relatedLinksForArticle）：
 * 链接标题（trim 后 ≥2 字符）与文章标题互为子串（忽略大小写）→ 同名（小写标题）去重保留点击数最大者，
 * 再按点击数降序取前 cap（默认 1）条。点击数并列时保持候选传入序（Array.sort 稳定 + Map 首现位置不变），
 * 因此调用方必须按「列表规范序」喂候选（static = 档案序；mysql = (sort_order,id)，两者恒等，P4 已验证）。
 */
export function pickRelatedLinks<T extends { title: string }>(
  candidates: RelatedLinkCandidate<T>[],
  articleTitle: string,
  cap = 1,
): T[] {
  const t = articleTitle.trim().toLowerCase()
  if (!t) return []
  const best = new Map<string, RelatedLinkCandidate<T>>()
  for (const c of candidates) {
    const lt = c.item.title.trim().toLowerCase()
    if (lt.length < 2) continue
    if (t.includes(lt) || lt.includes(t)) {
      const prev = best.get(lt)
      if (!prev || c.clicks > prev.clicks) best.set(lt, c)
    }
  }
  return [...best.values()]
    .sort((x, y) => y.clicks - x.clicks)
    .slice(0, cap)
    .map((c) => c.item)
}

/**
 * 站点详情「相关文章」（源站规则镜像，= util.relatedArticlesForLink）：
 * 文章标题（≥2 字符）与链接标题互为子串（忽略大小写）→ 按小写文章标题去重（保留首现，
 * 调用方须按列表规范序喂候选），按 createdAt 降序（并列保持首现序），最多 cap 条（默认 10）。
 */
export function pickRelatedArticles<T extends { title: string; createdAt: string }>(
  candidates: T[],
  linkTitle: string,
  cap = 10,
): T[] {
  const lt = linkTitle.trim().toLowerCase()
  if (lt.length < 2) return []
  const best = new Map<string, T>()
  for (const a of candidates) {
    const at = a.title.trim().toLowerCase()
    if (at.length < 2) continue
    if (at.includes(lt) || lt.includes(at)) {
      if (!best.has(at)) best.set(at, a)
    }
  }
  return [...best.values()]
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
    .slice(0, cap)
}
