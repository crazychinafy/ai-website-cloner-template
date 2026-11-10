// P4：静态 Mock 数据扫描（inspect）—— 只读，不修改数据库
// 用法：npm run admin:data:inspect [-- --json=<path>]
// 语义：
//   - 逐个读取 src/lib/facai8/data/ 全部 19 个存档文件，计算真实统计（不使用任何预写数量）
//   - 检查 ID 精度（17 位）、重复/缺失、外键关联、排序覆盖、图片资源存在性、URL 形态
//   - 图片资源只做本地文件存在性检查（public/sites/facai8/images/），绝不访问第三方 URL（P4 §七）
//   - 导出 inspectStaticData() 纯函数供单元测试复用；CLI 仅负责输出
import { existsSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { LINK_CATEGORIES, type CatNode } from "../../src/lib/facai8/data/categories.ts"
import { ALL_LINKS, type LinkItem } from "../../src/lib/facai8/data/links.ts"
import { CAT_ORDER, TAG_ORDER, applyLinkOrder } from "../../src/lib/facai8/data/link-order.ts"
import { LINK_DETAILS, type LinkDetailExtra } from "../../src/lib/facai8/data/link-details.ts"
import { LINK_MIRRORS, type LinkMirror } from "../../src/lib/facai8/data/link-mirrors.ts"
import { TAGS, type Tag } from "../../src/lib/facai8/data/tags.ts"
import { ARTICLE_CATEGORIES, type ArticleCategory } from "../../src/lib/facai8/data/article-categories.ts"
import { ALL_ARTICLES, type Article } from "../../src/lib/facai8/data/articles.ts"
import { BULLETINS, type Bulletin } from "../../src/lib/facai8/data/bulletins.ts"
import { HOME_ADS, type Ad } from "../../src/lib/facai8/data/ads.ts"
import { ALL_LINES, type LineItem } from "../../src/lib/facai8/data/lines.ts"
import { SITE_INFO } from "../../src/lib/facai8/data/site-info.ts"
import { ICON_LIBRARIES, type IconLibrary } from "../../src/lib/facai8/data/icon-libraries.ts"
import { SITE_STATIC } from "../../src/lib/facai8/data/site-static.ts"
import { HOME_POPUP } from "../../src/lib/facai8/data/popup.ts"
import { STATS } from "../../src/lib/facai8/data/stats.ts"
import { NEW_LINKS } from "../../src/lib/facai8/data/new-links.ts"
import { RECENT_LINKS } from "../../src/lib/facai8/data/recent-links.ts"
import { NEW_ARTICLES } from "../../src/lib/facai8/data/new-articles.ts"
import { SEARCH_DESCRIPTIONS } from "../../src/lib/facai8/data/searchDescriptions.ts"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const IMAGES_DIR = resolve(projectRoot, "public/sites/facai8/images")

const ID_RE = /^\d{1,20}$/
const ISO_SECOND_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/
const UPLOAD_RE = /^\/uploads\/.+/

/** util.ts asset() 的本地等价：/uploads/.../basename → public/sites/facai8/images/basename */
function localImageFile(p: string): string | null {
  if (!p || p.startsWith("http")) return null
  const base = decodeURIComponent(p.split("/").pop() || "")
  return base ? resolve(IMAGES_DIR, base) : null
}

function imageExt(path: string): string {
  const m = path.match(/\.(png|jpe?g|gif|webp|ico|svg)$/i)
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "unknown"
}

function badId(v: unknown): v is string {
  return typeof v !== "string" || !ID_RE.test(v)
}

function sample<T>(items: T[], n = 5): string[] {
  return items.slice(0, n).map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
}

/** 收集一段 HTML 中 <img src="..."> 引用的本地素材路径 */
function imgRefsInHtml(html: string): string[] {
  const out: string[] = []
  const re = /src="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out
}

export interface InspectReport {
  generatedAt: string
  files: { name: string; exports: string[] }[]
  categories: {
    topLevel: number
    children: number
    totalNodes: number
    duplicateIds: string[]
    missingIds: number // children/顶层 id 为空的个数
    sortOrderTiesTop: number // 顶层中 sortOrder 取值相同的组数（>0 表示存在并列）
    sortOrderTiesChild: number // 同一父级内子分类 sortOrder 并列组数
    arrayOrderMatchesSortIdTop: boolean // 顶层数组序 与 (sortOrder, id) 序是否一致
    arrayOrderMatchesSortIdChild: boolean // 各父级内子分类 数组序 与 (sortOrder, id) 序是否一致
    emptyIcon: number
  }
  links: {
    total: number
    uniqueIds: number
    duplicateIds: string[]
    idMaxLen: number
    ids17: number
    goneLinks: number
    withLogo: number
    localLogoPaths: number
    externalLogoUrls: number
    emptyDescription: number
    invalidUrls: number // 非 http(s) 开头
    orphanCategoryIds: string[] // categoryId 不在分类表
    orphanTagIds: string[] // tagId 不在标签表
    linksPerCategory: { categoryId: string; categoryName: string; count: number }[]
  }
  catOrder: {
    keys: number
    totalSequenceIds: number
    orphanIds: string[] // 序列内 id 不在 ALL_LINKS
    dupInSequence: number // 同一序列内重复 id 数
    coveredCategories: number
    uncoveredCategories: number
    // 每分类：CAT_ORDER 顺序 与 档案序（ALL_LINKS 文件序）是否一致（首页=档案序，分类页=CAT_ORDER）
    divergentCategories: number
    divergentSample: { categoryId: string; categoryName: string; catOrderLen: number; archiveLen: number }[]
  }
  tagOrder: {
    keys: number
    coveredTags: number
    uncoveredTags: number
    orphanIds: string[]
    totalSequenceIds: number
  }
  linkDetails: {
    entries: number
    fkMissing: string[] // 详情 id 不在 ALL_LINKS
    fkMissingCount: number
    clickCountNonNumeric: number
    likeCountNonNumeric: number
    badDateCount: number
    emptyDetail: number
    emptyAnnotation: number
    emptyPreviewImage: number
    categoryNameMismatch: number // categoryName 与链接所属分类名不一致
  }
  linkMirrors: {
    nonEmptyLinks: number
    totalMirrors: number
    maxPerLink: number
    mirrorIdTotal: number
    mirrorIdDup: string[] // mirror.id 全局重复（DB PK 需唯一）
    fkMissing: string[] // 链接 id 不在 ALL_LINKS
  }
  tags: { total: number; ids: string[] }
  articleCategories: {
    total: number
    sortOrderValues: string[]
    arrayOrderIsIdOrder: boolean
  }
  articles: {
    total: number
    duplicateIds: string[]
    fkMissing: string[]
    badDateCount: number
    createdAtUpdatedAtDiffer: number // 源数据 createdAt ≠ updatedAt 的篇数（影响 articles 表映射）
    nonNumericViewCount: number
    emptySeoTitle: number
    emptySeoDescription: number
    emptyCover: number
    emptyAuthorAvatar: number
    inlineImgRefs: number
  }
  bulletins: { total: number; badDateCount: number; inlineImgRefs: number }
  ads: {
    total: number
    duplicateLinkUrl: string[] // lowerAds() 按 linkUrl 反查，重复会改变取数
    duplicateId: string[]
    inlineImgRefs: number
  }
  lines: { total: number; badUrls: number }
  siteInfo: { siteName: string; siteDescription: string; siteLogo: string; siteFavicon: string; footerText: string; adsRandom: boolean }
  homePopup: { enabled: boolean; title: string; contentLen: number }
  stats: { links: string; articles: string; comments: string; totalViews: string; derivedCheck: { linksMatches: boolean; articlesMatches: boolean } }
  iconLibraries: { total: number; hashDup: string[]; arrayOrderIsIdOrder: boolean }
  siteStatic: { fields: { key: string; title: string; subtitle: string; htmlLen: number; imgRefs: number }[] }
  newLinks: { total: number; fkMissing: string[] }
  recentLinks: { total: number; fkMissing: string[]; overlapWithNew: number }
  newArticles: { total: number; fkMissing: string[] }
  searchDescriptions: {
    entries: number
    fkMissing: string[]
    equalsExcerptRule: number // 与本地 articleExcerpt(content) 规则一致的条目数（其余 = 源站索引快照，不可单规则复现）
  }
  assets: {
    uniqueLocalPaths: number
    existing: number
    missing: number
    missingSample: string[]
    byType: Record<string, number> // 已存在文件按扩展名统计引用数
    externalRefs: number // http(s) 直引（仅计数，不访问）
    totalRefs: number
  }
}

function excerptOf(html: string): string {
  const s = String(html || "").replace(/<[^>]+>/g, "")
  return s.length > 100 ? s.slice(0, 100) + "…" : s
}

export function inspectStaticData(): InspectReport {
  const catName = new Map<string, string>()
  for (const c of LINK_CATEGORIES) {
    catName.set(c.id, c.name)
    for (const s of c.children) catName.set(s.id, s.name)
  }

  /** 纯数字字符串比较（17/18 位 id 定长时字典序=数值序；异长先比长度，避免字典序≠数值序） */
  const cmpNumStr = (a: string, b: string): number => {
    if (a.length !== b.length) return a.length - b.length
    return a < b ? -1 : a > b ? 1 : 0
  }
  /** 并列检测/数组序一致性的排序键：sortOrder 按数值、id 按数值（定长填充后字典序=目标序） */
  const sortIdKey = (id: string, so: string): string =>
    `${Number(so).toString().padStart(10, "0")}\u0000${id.padStart(20, "0")}`

  // ── 分类 ──
  const allCatIds: string[] = []
  let childrenCount = 0
  let dupCatIds: string[] = []
  let missingCatIds = 0
  let emptyIcon = 0
  const seenCat = new Set<string>()
  for (const c of LINK_CATEGORIES) {
    if (c.id) {
      if (seenCat.has(c.id)) dupCatIds.push(c.id)
      seenCat.add(c.id)
      allCatIds.push(c.id)
    } else missingCatIds++
    if (!c.icon) emptyIcon++
    for (const s of c.children) {
      childrenCount++
      if (s.id) {
        if (seenCat.has(s.id)) dupCatIds.push(s.id)
        seenCat.add(s.id)
        allCatIds.push(s.id)
      } else missingCatIds++
      if (!s.icon) emptyIcon++
    }
  }
  // sortOrder 并列与数组序一致性（顶层 / 各父级内）—— 键见文件顶部 sortIdKey
  let tiesTop = 0
  const topSoCount = new Map<string, number>()
  for (const c of LINK_CATEGORIES) topSoCount.set(c.sortOrder, (topSoCount.get(c.sortOrder) ?? 0) + 1)
  for (const n of topSoCount.values()) if (n > 1) tiesTop++
  const topSeq = LINK_CATEGORIES.map((c) => sortIdKey(c.id, c.sortOrder))
  const topSorted = [...topSeq].sort()
  const arrayOrderMatchesSortIdTop = topSeq.every((v, i) => v === topSorted[i])
  let tiesChild = 0
  let childSeqOk = true
  for (const c of LINK_CATEGORIES) {
    const soCount = new Map<string, number>()
    for (const s of c.children) soCount.set(s.sortOrder, (soCount.get(s.sortOrder) ?? 0) + 1)
    for (const n of soCount.values()) if (n > 1) tiesChild++
    const seq = c.children.map((s) => sortIdKey(s.id, s.sortOrder))
    const sorted = [...seq].sort()
    if (!seq.every((v, i) => v === sorted[i])) childSeqOk = false
  }

  // ── 链接 ──
  const linkIdSet = new Set<string>()
  const linkDup: string[] = []
  let gone = 0
  let withLogo = 0
  let localLogo = 0
  let extLogo = 0
  let emptyDesc = 0
  let invalidUrl = 0
  let maxLen = 0
  let ids17 = 0
  const perCat = new Map<string, number>()
  const orphanCat: string[] = []
  const orphanTag: string[] = []
  for (const l of ALL_LINKS) {
    if (l.id) {
      if (linkIdSet.has(l.id)) linkDup.push(l.id)
      linkIdSet.add(l.id)
    }
    maxLen = Math.max(maxLen, l.id.length)
    if (l.id.length >= 17) ids17++
    if (l.isGone === 1) gone++
    if (l.logoUrl) {
      withLogo++
      if (l.logoUrl.startsWith("http")) extLogo++
      else localLogo++
    }
    if (!l.description) emptyDesc++
    if (!/^https?:\/\//.test(l.url)) invalidUrl++
    perCat.set(l.categoryId, (perCat.get(l.categoryId) ?? 0) + 1)
    if (!allCatIds.includes(l.categoryId) && !orphanCat.includes(l.categoryId)) orphanCat.push(l.categoryId)
    if (l.tagId && !TAGS.some((t) => t.id === l.tagId) && !orphanTag.includes(l.tagId)) orphanTag.push(l.tagId)
  }
  const linksPerCategory = [...perCat.entries()]
    .map(([categoryId, count]) => ({ categoryId, categoryName: catName.get(categoryId) ?? "?", count }))
    .sort((a, b) => b.count - a.count)

  // ── CAT_ORDER / TAG_ORDER ──
  let catSeqTotal = 0
  const catOrphans: string[] = []
  let catDupInSeq = 0
  let coveredCats = 0
  let uncoveredCats = 0
  let divergent = 0
  const divergentSample: InspectReport["catOrder"]["divergentSample"] = []
  for (const c of LINK_CATEGORIES) {
    const kids = c.children.map((s) => s.id)
    // 该分类节点（含子分类各自）被 CAT_ORDER 覆盖情况
    const nodes = [c.id, ...kids]
    const covered = nodes.filter((n) => (CAT_ORDER[n]?.length ?? 0) > 0)
    if (covered.length > 0) coveredCats++
    else uncoveredCats++
    for (const n of nodes) {
      const seq = CAT_ORDER[n] ?? []
      catSeqTotal += seq.length
      const seen = new Set<string>()
      for (const id of seq) {
        if (seen.has(id)) catDupInSeq++
        seen.add(id)
        if (!linkIdSet.has(id) && !catOrphans.includes(id)) catOrphans.push(id)
      }
      // 档案序 vs CAT_ORDER 序（首页与分类页的差异来源）
      const linksOfNode = ALL_LINKS.filter((l) => l.categoryId === n)
      if (linksOfNode.length === 0 && seq.length === 0) continue
      const canon = applyLinkOrder(linksOfNode, seq).map((l) => l.id)
      const archive = linksOfNode.map((l) => l.id)
      if (canon.join("\u0000") !== archive.join("\u0000")) {
        divergent++
        if (divergentSample.length < 8)
          divergentSample.push({ categoryId: n, categoryName: catName.get(n) ?? "?", catOrderLen: seq.length, archiveLen: linksOfNode.length })
      }
    }
  }
  let tagCovered = 0
  let tagUncovered = 0
  let tagSeqTotal = 0
  const tagOrphans: string[] = []
  for (const t of TAGS) {
    const seq = TAG_ORDER[t.id] ?? []
    tagSeqTotal += seq.length
    if (seq.length > 0) tagCovered++
    else tagUncovered++
    for (const id of seq) if (!linkIdSet.has(id) && !tagOrphans.includes(id)) tagOrphans.push(id)
  }

  // ── 详情 / 备用 ──
  const detailEntries = Object.values(LINK_DETAILS)
  const detailFkMissing = detailEntries.filter((d) => !linkIdSet.has(d.id)).map((d) => d.id)
  let clickBad = 0
  let likeBad = 0
  let detailBadDate = 0
  let detailEmptyDetail = 0
  let detailEmptyAnno = 0
  let detailEmptyPreview = 0
  let catNameMismatch = 0
  for (const d of detailEntries) {
    if (!/^\d+$/.test(d.clickCount)) clickBad++
    if (!/^\d+$/.test(d.likeCount)) likeBad++
    if (!ISO_SECOND_RE.test(d.createdAt) || !ISO_SECOND_RE.test(d.updatedAt)) detailBadDate++
    if (!d.detail) detailEmptyDetail++
    if (!d.annotation) detailEmptyAnno++
    if (!d.previewImage) detailEmptyPreview++
    const linksOfDetail = ALL_LINKS.filter((l) => l.id === d.id)
    if (linksOfDetail.length > 0 && d.categoryName) {
      const expect = catName.get(linksOfDetail[0].categoryId)
      if (expect !== undefined && expect !== d.categoryName) catNameMismatch++
    }
  }
  const mirrorKeys = Object.keys(LINK_MIRRORS)
  let mirrorTotal = 0
  let mirrorMaxPer = 0
  const mirrorIds = new Set<string>()
  const mirrorIdDup: string[] = []
  const mirrorFkMissing: string[] = []
  for (const key of mirrorKeys) {
    const arr = LINK_MIRRORS[key]
    if (!arr) continue
    mirrorTotal += arr.length
    mirrorMaxPer = Math.max(mirrorMaxPer, arr.length)
    if (!linkIdSet.has(key) && !mirrorFkMissing.includes(key)) mirrorFkMissing.push(key)
    for (const m of arr) {
      if (mirrorIds.has(m.id)) mirrorIdDup.push(m.id)
      mirrorIds.add(m.id)
    }
  }

  // ── 文章 ──
  const artCatIds = new Set(ARTICLE_CATEGORIES.map((c) => c.id))
  const artDup: string[] = []
  const artSeen = new Set<string>()
  const artFkMissing: string[] = []
  let artBadDate = 0
  let artCrUpDiffer = 0
  let artViewBad = 0
  let artSeoTitleEmpty = 0
  let artSeoDescEmpty = 0
  let artCoverEmpty = 0
  let artAvatarEmpty = 0
  let artImgRefs = 0
  for (const a of ALL_ARTICLES) {
    if (a.id) {
      if (artSeen.has(a.id)) artDup.push(a.id)
      artSeen.add(a.id)
    }
    if (!artCatIds.has(a.categoryId) && !artFkMissing.includes(a.categoryId)) artFkMissing.push(a.categoryId)
    if (!ISO_SECOND_RE.test(a.createdAt) || !ISO_SECOND_RE.test(a.updatedAt)) artBadDate++
    if (a.createdAt !== a.updatedAt) artCrUpDiffer++
    if (!/^\d+$/.test(a.viewCount)) artViewBad++
    if (!a.seoTitle) artSeoTitleEmpty++
    if (!a.seoDescription) artSeoDescEmpty++
    if (!a.coverImage) artCoverEmpty++
    if (!a.authorAvatar) artAvatarEmpty++
    artImgRefs += imgRefsInHtml(a.content).filter((s) => UPLOAD_RE.test(s)).length
  }

  // ── 公告 / 广告 / 线路 ──
  let bulBadDate = 0
  let bulImgRefs = 0
  for (const b of BULLETINS) {
    if (!ISO_SECOND_RE.test(b.createdAt)) bulBadDate++
    bulImgRefs += imgRefsInHtml(b.content).filter((s) => UPLOAD_RE.test(s)).length
  }
  const adUrlCount = new Map<string, number>()
  const adDupUrl: string[] = []
  const adIdSeen = new Set<string>()
  const adDupId: string[] = []
  let adImgRefs = 0
  for (const a of HOME_ADS) {
    adUrlCount.set(a.linkUrl, (adUrlCount.get(a.linkUrl) ?? 0) + 1)
    if (a.id && adIdSeen.has(a.id)) adDupId.push(a.id)
    adIdSeen.add(a.id)
    adImgRefs += 1 // imageUrl 直引
  }
  for (const [u, n] of adUrlCount) if (n > 1) adDupUrl.push(u)
  let linesBadUrl = 0
  for (const l of ALL_LINES) if (!/^https?:\/\//.test(l.url)) linesBadUrl++

  // ── 站点静态页 ──
  const siteStaticFields = (Object.keys(SITE_STATIC) as (keyof typeof SITE_STATIC)[]).map((key) => {
    const v = SITE_STATIC[key]
    return { key: key as string, title: v.title, subtitle: v.subtitle, htmlLen: v.html.length, imgRefs: imgRefsInHtml(v.html).filter((s) => UPLOAD_RE.test(s)).length }
  })

  // ── 派生数据 ──
  const newLinksFk = NEW_LINKS.filter((l) => !linkIdSet.has(l.id)).map((l) => l.id)
  const recentLinksFk = RECENT_LINKS.filter((l) => !linkIdSet.has(l.id)).map((l) => l.id)
  const newSet = new Set(NEW_LINKS.map((l) => l.id))
  const recentSet = new Set(RECENT_LINKS.map((l) => l.id))
  const overlapNewRecent = [...newSet].filter((x) => recentSet.has(x)).length
  const newArtFk = NEW_ARTICLES.filter((a) => !artSeen.has(a.id)).map((a) => a.id)

  // ── 搜索描述快照 ──
  const sdEntries = Object.keys(SEARCH_DESCRIPTIONS)
  const sdFkMissing = sdEntries.filter((id) => !artSeen.has(id))
  const artById = new Map(ALL_ARTICLES.map((a) => [a.id, a]))
  let sdEqualsExcerpt = 0
  for (const id of sdEntries) {
    const a = artById.get(id)
    if (a && SEARCH_DESCRIPTIONS[id] === excerptOf(a.content)) sdEqualsExcerpt++
  }

  // ── 图标库 ──
  const hashCount = new Map<string, number>()
  for (const i of ICON_LIBRARIES) hashCount.set(i.hash, (hashCount.get(i.hash) ?? 0) + 1)
  const iconHashDup = [...hashCount.entries()].filter(([, n]) => n > 1).map(([h]) => h)
  const iconIds = ICON_LIBRARIES.map((i) => i.id)
  const iconIdsSorted = [...iconIds].sort(cmpNumStr)
  const iconOrderOk = iconIds.every((v, i) => v === iconIdsSorted[i])

  // ── 文章分类序（数值比较）──
  const acIds = ARTICLE_CATEGORIES.map((c) => c.id)
  const acIdsSorted = [...acIds].sort(cmpNumStr)
  const acOrderOk = acIds.every((v, i) => v === acIdsSorted[i])

  // ── 图片资源（本地存在性；外部 URL 仅计数不访问）──
  const refCount = new Map<string, number>()
  const bump = (p: string | null | undefined) => {
    if (!p) return
    refCount.set(p, (refCount.get(p) ?? 0) + 1)
  }
  for (const l of ALL_LINKS) bump(l.logoUrl)
  for (const d of Object.values(LINK_DETAILS)) {
    bump(d.previewImage)
    bump(d.logoUrl)
    imgRefsInHtml(d.detail).forEach((s) => bump(s))
  }
  for (const a of ALL_ARTICLES) {
    bump(a.coverImage)
    bump(a.authorAvatar)
    imgRefsInHtml(a.content).forEach((s) => bump(s))
  }
  for (const ad of HOME_ADS) bump(ad.imageUrl)
  for (const b of BULLETINS) imgRefsInHtml(b.content).forEach((s) => bump(s))
  imgRefsInHtml(HOME_POPUP.content).forEach((s) => bump(s))
  for (const f of Object.values(SITE_STATIC)) imgRefsInHtml(f.html).forEach((s) => bump(s))
  bump(SITE_INFO.siteLogo)
  bump(SITE_INFO.siteFavicon)

  let totalRefs = 0
  let localUnique = 0
  let existing = 0
  let missing = 0
  let external = 0
  const byType: Record<string, number> = {}
  const missingSample: string[] = []
  for (const [p, n] of refCount) {
    totalRefs += n
    if (p.startsWith("http")) {
      external += n
      continue
    }
    localUnique++
    const f = localImageFile(p)
    if (!f || !existsSync(f)) {
      missing += n
      if (missingSample.length < 15) missingSample.push(p)
      continue
    }
    existing += n
    const t = imageExt(f)
    byType[t] = (byType[t] ?? 0) + n
  }

  return {
    generatedAt: new Date().toISOString(),
    files: [
      { name: "categories.ts", exports: ["LINK_CATEGORIES", "CatNode"] },
      { name: "links.ts", exports: ["ALL_LINKS", "LinkItem"] },
      { name: "link-order.ts", exports: ["CAT_ORDER", "TAG_ORDER", "applyLinkOrder"] },
      { name: "link-details.ts", exports: ["LINK_DETAILS", "LinkDetailExtra"] },
      { name: "link-mirrors.ts", exports: ["LINK_MIRRORS", "LinkMirror"] },
      { name: "tags.ts", exports: ["TAGS", "Tag"] },
      { name: "articles.ts", exports: ["ALL_ARTICLES", "Article"] },
      { name: "article-categories.ts", exports: ["ARTICLE_CATEGORIES", "ArticleCategory"] },
      { name: "bulletins.ts", exports: ["BULLETINS", "Bulletin"] },
      { name: "ads.ts", exports: ["HOME_ADS", "Ad"] },
      { name: "lines.ts", exports: ["ALL_LINES", "LineItem"] },
      { name: "site-info.ts", exports: ["SITE_INFO"] },
      { name: "icon-libraries.ts", exports: ["ICON_LIBRARIES", "IconLibrary"] },
      { name: "site-static.ts", exports: ["SITE_STATIC"] },
      { name: "popup.ts", exports: ["HOME_POPUP"] },
      { name: "stats.ts", exports: ["STATS"] },
      { name: "new-links.ts", exports: ["NEW_LINKS", "MiniLink"] },
      { name: "recent-links.ts", exports: ["RECENT_LINKS", "MiniLink"] },
      { name: "new-articles.ts", exports: ["NEW_ARTICLES", "MiniArticle"] },
      { name: "searchDescriptions.ts", exports: ["SEARCH_DESCRIPTIONS"] },
    ],
    categories: {
      topLevel: LINK_CATEGORIES.length,
      children: childrenCount,
      totalNodes: LINK_CATEGORIES.length + childrenCount,
      duplicateIds: dupCatIds,
      missingIds: missingCatIds,
      sortOrderTiesTop: tiesTop,
      sortOrderTiesChild: tiesChild,
      arrayOrderMatchesSortIdTop,
      arrayOrderMatchesSortIdChild: childSeqOk,
      emptyIcon,
    },
    links: {
      total: ALL_LINKS.length,
      uniqueIds: linkIdSet.size,
      duplicateIds: linkDup,
      idMaxLen: maxLen,
      ids17,
      goneLinks: gone,
      withLogo,
      localLogoPaths: localLogo,
      externalLogoUrls: extLogo,
      emptyDescription: emptyDesc,
      invalidUrls: invalidUrl,
      orphanCategoryIds: orphanCat,
      orphanTagIds: orphanTag,
      linksPerCategory: linksPerCategory,
    },
    catOrder: {
      keys: Object.keys(CAT_ORDER).length,
      totalSequenceIds: catSeqTotal,
      orphanIds: catOrphans,
      dupInSequence: catDupInSeq,
      coveredCategories: coveredCats,
      uncoveredCategories: uncoveredCats,
      divergentCategories: divergent,
      divergentSample,
    },
    tagOrder: {
      keys: Object.keys(TAG_ORDER).length,
      coveredTags: tagCovered,
      uncoveredTags: tagUncovered,
      orphanIds: tagOrphans,
      totalSequenceIds: tagSeqTotal,
    },
    linkDetails: {
      entries: detailEntries.length,
      fkMissing: sample(detailFkMissing),
      fkMissingCount: detailFkMissing.length,
      clickCountNonNumeric: clickBad,
      likeCountNonNumeric: likeBad,
      badDateCount: detailBadDate,
      emptyDetail: detailEmptyDetail,
      emptyAnnotation: detailEmptyAnno,
      emptyPreviewImage: detailEmptyPreview,
      categoryNameMismatch: catNameMismatch,
    },
    linkMirrors: {
      nonEmptyLinks: mirrorKeys.filter((k) => (LINK_MIRRORS[k]?.length ?? 0) > 0).length,
      totalMirrors: mirrorTotal,
      maxPerLink: mirrorMaxPer,
      mirrorIdTotal: mirrorIds.size,
      mirrorIdDup,
      fkMissing: sample(mirrorFkMissing),
    },
    tags: { total: TAGS.length, ids: TAGS.map((t: Tag) => t.id) },
    articleCategories: {
      total: ARTICLE_CATEGORIES.length,
      sortOrderValues: ARTICLE_CATEGORIES.map((c: ArticleCategory) => c.sortOrder),
      arrayOrderIsIdOrder: acOrderOk,
    },
    articles: {
      total: ALL_ARTICLES.length,
      duplicateIds: artDup,
      fkMissing: artFkMissing,
      badDateCount: artBadDate,
      createdAtUpdatedAtDiffer: artCrUpDiffer,
      nonNumericViewCount: artViewBad,
      emptySeoTitle: artSeoTitleEmpty,
      emptySeoDescription: artSeoDescEmpty,
      emptyCover: artCoverEmpty,
      emptyAuthorAvatar: artAvatarEmpty,
      inlineImgRefs: artImgRefs,
    },
    bulletins: { total: BULLETINS.length, badDateCount: bulBadDate, inlineImgRefs: bulImgRefs },
    ads: { total: HOME_ADS.length, duplicateLinkUrl: adDupUrl, duplicateId: adDupId, inlineImgRefs: adImgRefs },
    lines: { total: ALL_LINES.length, badUrls: linesBadUrl },
    siteInfo: { ...SITE_INFO },
    homePopup: { enabled: HOME_POPUP.enabled, title: HOME_POPUP.title, contentLen: HOME_POPUP.content.length },
    stats: {
      ...STATS,
      derivedCheck: {
        linksMatches: STATS.links === String(ALL_LINKS.length),
        articlesMatches: STATS.articles === String(ALL_ARTICLES.length),
      },
    },
    iconLibraries: { total: ICON_LIBRARIES.length, hashDup: iconHashDup, arrayOrderIsIdOrder: iconOrderOk },
    siteStatic: { fields: siteStaticFields },
    newLinks: { total: NEW_LINKS.length, fkMissing: newLinksFk },
    recentLinks: { total: RECENT_LINKS.length, fkMissing: recentLinksFk, overlapWithNew: overlapNewRecent },
    newArticles: { total: NEW_ARTICLES.length, fkMissing: newArtFk },
    searchDescriptions: {
      entries: sdEntries.length,
      fkMissing: sdFkMissing,
      equalsExcerptRule: sdEqualsExcerpt,
    },
    assets: {
      uniqueLocalPaths: localUnique,
      existing,
      missing,
      missingSample,
      byType,
      externalRefs: external,
      totalRefs,
    },
  }
}

function printReport(r: InspectReport): void {
  const c = (s: string) => s
  console.log(c(`\n== P4 静态数据扫描（${r.generatedAt}）==`))
  console.log(`\n[分类] 顶层=${r.categories.topLevel} 子=${r.categories.children} 总=${r.categories.totalNodes} 重复ID=${r.categories.duplicateIds.length} 空ID=${r.categories.missingIds} 空图标=${r.categories.emptyIcon}`)
  console.log(`  顶层 sortOrder 并列组=${r.categories.sortOrderTiesTop}（数组序==（sortOrder,id）序: ${r.categories.arrayOrderMatchesSortIdTop}）`)
  console.log(`  子级 sortOrder 并列组=${r.categories.sortOrderTiesChild}（各父级内数组序==（sortOrder,id）序: ${r.categories.arrayOrderMatchesSortIdChild}）`)
  const l = r.links
  console.log(`\n[链接] 总=${l.total} 唯一ID=${l.uniqueIds} 重复=${l.duplicateIds.length} 最长ID=${l.idMaxLen}位 17位=${l.ids17}`)
  console.log(`  已关站=${l.goneLinks} 有logo=${l.withLogo}（本地路径=${l.localLogoPaths} 外部URL=${l.externalLogoUrls}）空描述=${l.emptyDescription} 非法URL=${l.invalidUrls}`)
  console.log(`  孤儿分类ID=${l.orphanCategoryIds.length}${l.orphanCategoryIds.length ? " " + sample(l.orphanCategoryIds) : ""} 孤儿标签ID=${l.orphanTagIds.length}${l.orphanTagIds.length ? " " + sample(l.orphanTagIds) : ""}`)
  console.log(`  分类数=${l.linksPerCategory.length}（最大 ${l.linksPerCategory[0]?.categoryName}=${l.linksPerCategory[0]?.count}，最小 ${l.linksPerCategory[l.linksPerCategory.length - 1]?.categoryName}=${l.linksPerCategory[l.linksPerCategory.length - 1]?.count}）`)
  const co = r.catOrder
  console.log(`\n[CAT_ORDER] keys=${co.keys} 序列ID总=${co.totalSequenceIds} 孤儿ID=${co.orphanIds.length} 序列内重复=${co.dupInSequence}`)
  console.log(`  覆盖分类=${co.coveredCategories} 未覆盖=${co.uncoveredCategories}（未覆盖回退档案序）`)
  console.log(`  档案序≠CAT_ORDER序 的节点=${co.divergentCategories}（首页=档案序、分类页=CAT_ORDER 的显示差异来源）`)
  for (const d of co.divergentSample) console.log(`    例: ${d.categoryName}(${d.categoryId}) catOrder=${d.catOrderLen} archive=${d.archiveLen}`)
  const to = r.tagOrder
  console.log(`\n[TAG_ORDER] keys=${to.keys}（标签共 ${r.tags.total}：覆盖=${to.coveredTags} 未覆盖=${to.uncoveredTags}）序列ID总=${to.totalSequenceIds} 孤儿=${to.orphanIds.length}`)
  const ld = r.linkDetails
  console.log(`\n[详情] 条数=${ld.entries} 外键缺失=${ld.fkMissingCount} click非数字=${ld.clickCountNonNumeric} like非数字=${ld.likeCountNonNumeric} 日期格式异常=${ld.badDateCount}`)
  console.log(`  空detail=${ld.emptyDetail} 空annotation=${ld.emptyAnnotation} 空previewImage=${ld.emptyPreviewImage} categoryName不一致=${ld.categoryNameMismatch}`)
  const lm = r.linkMirrors
  console.log(`\n[备用链接] 非空链接=${lm.nonEmptyLinks} 镜像总=${lm.totalMirrors} 单链接最多=${lm.maxPerLink} mirror.id重复=${lm.mirrorIdDup.length} 外键缺失=${lm.fkMissing.length}`)
  console.log(`\n[标签] ${r.tags.total} 条: ${r.tags.ids.join(", ")}`)
  const ac = r.articleCategories
  console.log(`\n[文章分类] ${ac.total} 条 sortOrder=${JSON.stringify(ac.sortOrderValues)} 数组序==id序:${ac.arrayOrderIsIdOrder}`)
  const a = r.articles
  console.log(`\n[文章] 总=${a.total} 重复=${a.duplicateIds.length} 外键缺失=${a.fkMissing.length} 日期异常=${a.badDateCount} createdAt≠updatedAt=${a.createdAtUpdatedAtDiffer} viewCount非数字=${a.nonNumericViewCount}`)
  console.log(`  seoTitle空=${a.emptySeoTitle} seoDescription空=${a.emptySeoDescription} 空封面=${a.emptyCover} 空头像=${a.emptyAuthorAvatar} 正文内嵌图引用=${a.inlineImgRefs}`)
  console.log(`\n[公告] ${r.bulletins.total} 条 日期异常=${r.bulletins.badDateCount} 内嵌图引用=${r.bulletins.inlineImgRefs}`)
  console.log(`\n[广告] ${r.ads.total} 条 linkUrl重复=${r.ads.duplicateLinkUrl.length} id重复=${r.ads.duplicateId.length} 图引用=${r.ads.inlineImgRefs}`)
  console.log(`\n[线路] ${r.lines.total} 条 非法URL=${r.lines.badUrls}`)
  console.log(`\n[站点信息] ${JSON.stringify(r.siteInfo)}`)
  console.log(`[首页弹窗] enabled=${r.homePopup.enabled} title="${r.homePopup.title}" content=${r.homePopup.contentLen}字符`)
  console.log(`[统计] links=${r.stats.links}(==${ALL_LINKS.length}? ${r.stats.derivedCheck.linksMatches}) articles=${r.stats.articles}(==${ALL_ARTICLES.length}? ${r.stats.derivedCheck.articlesMatches}) comments=${r.stats.comments} totalViews=${r.stats.totalViews}（comments/totalViews 无源数据行 → 运营快照）`)
  console.log(`\n[图标库] ${r.iconLibraries.total} 条 hash重复=${r.iconLibraries.hashDup.length} 数组序==id序:${r.iconLibraries.arrayOrderIsIdOrder}`)
  for (const f of r.siteStatic.fields) console.log(`[站点页面] ${f.key}: "${f.title}" / "${f.subtitle}" html=${f.htmlLen}字符 内嵌图=${f.imgRefs}`)
  console.log(`\n[最新收录] ${r.newLinks.total} 条 外键缺失=${r.newLinks.fkMissing.length}`)
  console.log(`[最近更新] ${r.recentLinks.total} 条 外键缺失=${r.recentLinks.fkMissing.length} 与最新重合=${r.recentLinks.overlapWithNew}`)
  console.log(`[最新文章] ${r.newArticles.total} 条 外键缺失=${r.newArticles.fkMissing.length}`)
  const sd = r.searchDescriptions
  console.log(`[搜索描述快照] ${sd.entries} 条（文章共 ${a.total}）外键缺失=${sd.fkMissing.length} 与本地截断规则一致=${sd.equalsExcerptRule}（其余为源站索引快照，不可单规则复现）`)
  const as = r.assets
  console.log(`\n[图片资源] 本地唯一路径=${as.uniqueLocalPaths} 引用总=${as.totalRefs}（含外链 ${as.externalRefs}，仅计数不访问）`)
  console.log(`  存在=${as.existing} 缺失=${as.missing} 类型=${JSON.stringify(as.byType)}`)
  if (as.missing > 0) console.log(`  缺失示例: ${as.missingSample.join(", ")}`)
  console.log(`\n图片目录: ${IMAGES_DIR}（${readdirSync(IMAGES_DIR).length} 个文件）\n`)
}

async function main(): Promise<void> {
  const jsonPath = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length)
  const report = inspectStaticData()
  printReport(report)
  if (jsonPath) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    console.log(`JSON 报告已写入 ${jsonPath}`)
  }
}

// 仅在直接执行时运行 CLI（vitest 导入本模块时不触发）
const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isDirectRun) {
  main().catch((err: Error) => {
    console.error(`[inspect] FAIL: ${err.message}`)
    process.exit(1)
  })
}
