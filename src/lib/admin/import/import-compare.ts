// P7：导入差异引擎（纯函数；从 scripts/admin/verify-static-import.ts 抽取并扩展比对逻辑）
// ─────────────────────────────────────────────────────────────────
// 输入：静态快照行（StaticSnapshot 各数组）+ 数据库当前行（drizzle selectAll 平面对象）；
// 输出：每表 missing / extra / changed / order_changed / relation_error 差异。
// 显式规范化规则（与 P4 verify 一致，不通过放宽相等来「对齐」）：
//   - ID：两侧一律十进制字符串（BIGINT 精度保护；17/18 位全量比对）
//   - 日期：两侧规范形 "YYYY-MM-DDTHH:MM:SS"（DB 墙钟空格形/Date 对象统一转 T 分隔、秒精度）
//   - 计数（click/like/view）与布尔：标量归一后字符串/布尔等值
//   - null 与 "" 严格区分；JSON（site_settings）深比较（DB 字符串形态防御性解一层）
//   - 只比对快照承载字段（DB 侧审计/状态列 status/version/created_at 等不参与差异）
// 顺序口径（order_changed）：按「消费序」比对 —— 分类 = 树形前序（同层按 sort_order,id）；
//   链接 = 分类分组内按 (sort_order,id)；含 sort_order 的表按 (sort_order,id)；
//   文章按 (published_at,id) 倒序（前台最新序）；其余按键升序。仅当两侧行集合相等时评估。
// 本模块被 CLI 脚本（verify-static-import.ts）与后台导入服务共用：
//   禁止 import "server-only" / next/* / "@/" 别名，只允许相对路径。
export type Rec = Record<string, unknown>

export const DIFF_LIST_CAP = 100
export const DIFF_CHANGED_FIELD_CAP = 30

/** 序列比对（键序列）；返回差异位置数 */
export function diffPositions(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) if ((a[i] ?? "∅") !== (b[i] ?? "∅")) d++
  return d
}

/** 深度相等（数组/对象递归；标量 Object.is） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || Array.isArray(b)) return false
    const ka = Object.keys(a as Rec)
    const kb = Object.keys(b as Rec)
    if (ka.length !== kb.length) return false
    return ka.every(
      (k) =>
        (a as Rec)[k] === (b as Rec)[k] || deepEqual((a as Rec)[k], (b as Rec)[k]),
    )
  }
  return false
}

// ── 值规范化（快照侧与 DB 侧都先归一再比对） ──────────────────────────────

/** BIGINT/number/string → 十进制字符串；null/undefined → null；空串保持 "" */
export function normId(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === "bigint") return v.toString()
  if (typeof v === "number") return String(v)
  return String(v)
}

/** 日期 → 规范形 "YYYY-MM-DDTHH:MM:SS"（接受空格墙钟 / T 形 / Date；null 透传） */
export function normWall(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 19)
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 10) + "T" + s.slice(11, 19)
  return s
}

/** tinyint/0-1/boolean → boolean */
export function normBool(v: unknown): boolean {
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v !== "" && v !== "0"
  return Boolean(v)
}

/** int/sortOrder → 可比较数字（非法 → NaN，比对自然失败并如实上报） */
export function normNum(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "bigint") return Number(v)
  const n = Number(v)
  return n
}

/** JSON 值（DB json 列通常已被驱动解析；若为字符串形态防御性解一层，解不动保持原样） */
export function normJson(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    const p: unknown = JSON.parse(v)
    return p
  } catch {
    return v
  }
}

// ── 表规格（13 张内容表；快照键 ↔ DB 行映射） ─────────────────────────────

export interface ProjectedRow {
  key: string
  fields: Record<string, unknown>
  /** 排序辅助值（orderSeq 用） */
  aux: Record<string, string | number | null>
}

export interface TableSpec {
  id: string
  label: string
  snapProject: (row: Rec) => ProjectedRow
  dbProject: (row: Rec) => ProjectedRow
  /** 消费序键序列（对投影行集合排序） */
  orderSeq: (rows: ProjectedRow[]) => string[]
  /** 行级关联完整性（sets = 各表键集合）；返回错误描述或 null */
  relation?: (row: ProjectedRow, sets: RelationSets) => string | null
}

export interface RelationSets {
  link_categories: Set<string>
  article_categories: Set<string>
  site_tags: Set<string>
  site_links: Set<string>
}

function pad(s: string | null, width = 20): string {
  return (s ?? "").padStart(width, "0")
}
function padNum(n: number): string {
  return String(n).padStart(10, "0")
}

function simpleOrderSeq(keys: (r: ProjectedRow) => string[]): (rows: ProjectedRow[]) => string[] {
  return (rows) =>
    [...rows]
      .sort((a, b) => {
        const ka = keys(a)
        const kb = keys(b)
        for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
          const x = ka[i] ?? ""
          const y = kb[i] ?? ""
          if (x !== y) return x < y ? -1 : 1
        }
        return 0
      })
      .map((r) => r.key)
}

/** 树形前序：根按 (sortOrder,id)，每个根后接其子级按 (sortOrder,id)；孤儿追加在尾部 */
function treeOrderSeq(rows: ProjectedRow[]): string[] {
  const out: string[] = []
  const byParent = new Map<string | null, ProjectedRow[]>()
  const keys = new Set(rows.map((r) => r.key))
  for (const r of rows) {
    const p = (r.aux.parentId as string | null) ?? null
    const effective = p !== null && !keys.has(p) ? "__orphan__" : p
    const arr = byParent.get(effective) ?? []
    arr.push(r)
    byParent.set(effective, arr)
  }
  const sortLayer = (arr: ProjectedRow[]) =>
    [...arr].sort((a, b) => {
      const sa = padNum(Number(a.aux.sortOrder ?? 0))
      const sb = padNum(Number(b.aux.sortOrder ?? 0))
      if (sa !== sb) return sa < sb ? -1 : 1
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })
  for (const r of sortLayer(byParent.get(null) ?? [])) {
    out.push(r.key)
    for (const c of sortLayer(byParent.get(r.key) ?? [])) out.push(c.key)
  }
  for (const c of sortLayer(byParent.get("__orphan__") ?? [])) out.push(c.key)
  return out
}

const idAsc = simpleOrderSeq((r) => [r.key])

export const IMPORT_TABLE_SPECS: TableSpec[] = [
  {
    id: "link_categories",
    label: "网址分类",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        parentId: normId(r.parentId),
        name: String(r.name ?? ""),
        iconClass: String(r.iconClass ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { parentId: normId(r.parentId), sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        parentId: normId(r.parentId),
        name: String(r.name ?? ""),
        iconClass: String(r.iconClass ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { parentId: normId(r.parentId), sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: treeOrderSeq,
    relation: (row, sets) =>
      row.aux.parentId !== null && !sets.link_categories.has(row.aux.parentId as string)
        ? `${row.key} 的父分类 ${row.aux.parentId} 不存在`
        : null,
  },
  {
    id: "article_categories",
    label: "文章分类",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: { name: String(r.name ?? ""), iconClass: String(r.iconClass ?? ""), sortOrder: normNum(r.sortOrder) },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: { name: String(r.name ?? ""), iconClass: String(r.iconClass ?? ""), sortOrder: normNum(r.sortOrder) },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
  },
  {
    id: "site_tags",
    label: "标签",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        name: String(r.name ?? ""),
        iconClass: String(r.iconClass ?? ""),
        color: String(r.color ?? ""),
        bgColor: String(r.bgColor ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        name: String(r.name ?? ""),
        iconClass: String(r.iconClass ?? ""),
        color: String(r.color ?? ""),
        bgColor: String(r.bgColor ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
  },
  {
    id: "site_links",
    label: "网址",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        categoryId: normId(r.categoryId),
        tagId: normId(r.tagId),
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        description: String(r.description ?? ""),
        logoPath: String(r.logoPath ?? ""),
        isGone: normBool(r.isGone),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { categoryId: normId(r.categoryId), tagId: normId(r.tagId), sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        categoryId: normId(r.categoryId),
        tagId: normId(r.tagId),
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        description: String(r.description ?? ""),
        logoPath: String(r.logoPath ?? ""),
        isGone: normBool(r.isGone),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { categoryId: normId(r.categoryId), tagId: normId(r.tagId), sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [pad(r.aux.categoryId as string | null), padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
    relation: (row, sets) => {
      const errors: string[] = []
      if (row.aux.categoryId === null || !sets.link_categories.has(row.aux.categoryId as string))
        errors.push(`${row.key} 的分类 ${row.aux.categoryId} 不存在`)
      // tagId 可空：!= null 同时挡掉 undefined（缺字段不得误报悬挂）
      if (row.aux.tagId != null && !sets.site_tags.has(row.aux.tagId as string))
        errors.push(`${row.key} 的标签 ${row.aux.tagId} 不存在`)
      return errors.length > 0 ? errors.join("；") : null
    },
  },
  {
    id: "site_link_details",
    label: "网址详情",
    snapProject: (r) => ({
      key: normId(r.linkId)!,
      fields: {
        clickCount: normId(r.clickCount),
        likeCount: normId(r.likeCount),
        annotation: String(r.annotation ?? ""),
        previewImage: String(r.previewImage ?? ""),
        detailHtml: String(r.detailHtml ?? ""),
        sourceCreatedAt: normWall(r.sourceCreatedAt),
        sourceUpdatedAt: normWall(r.sourceUpdatedAt),
      },
      aux: {},
    }),
    dbProject: (r) => ({
      key: normId(r.linkId)!,
      fields: {
        clickCount: normId(r.clickCount),
        likeCount: normId(r.likeCount),
        annotation: String(r.annotation ?? ""),
        previewImage: String(r.previewImage ?? ""),
        detailHtml: String(r.detailHtml ?? ""),
        sourceCreatedAt: normWall(r.sourceCreatedAt),
        sourceUpdatedAt: normWall(r.sourceUpdatedAt),
      },
      aux: {},
    }),
    orderSeq: idAsc,
    relation: (row, sets) => (!sets.site_links.has(row.key) ? `详情 ${row.key} 的链接不存在（孤儿详情）` : null),
  },
  {
    id: "site_link_mirrors",
    label: "备用链接",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        linkId: normId(r.linkId),
        name: String(r.name ?? ""),
        url: String(r.url ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { linkId: normId(r.linkId), sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        linkId: normId(r.linkId),
        name: String(r.name ?? ""),
        url: String(r.url ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { linkId: normId(r.linkId), sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [pad(r.aux.linkId as string | null), padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
    relation: (row, sets) =>
      row.aux.linkId === null || !sets.site_links.has(row.aux.linkId as string)
        ? `备用链接 ${row.key} 的链接 ${row.aux.linkId} 不存在`
        : null,
  },
  {
    id: "articles",
    label: "文章",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        categoryId: normId(r.categoryId),
        title: String(r.title ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
        coverImage: String(r.coverImage ?? ""),
        categoryNameSnapshot: String(r.categoryNameSnapshot ?? ""),
        seoTitle: String(r.seoTitle ?? ""),
        seoKeywords: String(r.seoKeywords ?? ""),
        seoDescription: String(r.seoDescription ?? ""),
        viewCount: normId(r.viewCount),
        authorName: String(r.authorName ?? ""),
        authorAvatar: String(r.authorAvatar ?? ""),
        publishedAt: normWall(r.publishedAt),
        updatedAt: normWall(r.sourceUpdatedAt), // 快照 sourceUpdatedAt ↔ 审计列 updated_at（P4 无损映射）
      },
      aux: { categoryId: normId(r.categoryId), publishedAt: normWall(r.publishedAt) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        categoryId: normId(r.categoryId),
        title: String(r.title ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
        coverImage: String(r.coverImage ?? ""),
        categoryNameSnapshot: String(r.categoryNameSnapshot ?? ""),
        seoTitle: String(r.seoTitle ?? ""),
        seoKeywords: String(r.seoKeywords ?? ""),
        seoDescription: String(r.seoDescription ?? ""),
        viewCount: normId(r.viewCount),
        authorName: String(r.authorName ?? ""),
        authorAvatar: String(r.authorAvatar ?? ""),
        publishedAt: normWall(r.publishedAt),
        updatedAt: normWall(r.updatedAt),
      },
      aux: { categoryId: normId(r.categoryId), publishedAt: normWall(r.publishedAt) },
    }),
    // 前台消费序 = published_at DESC, id DESC（最新在上）
    orderSeq: simpleOrderSeq((r) => {
      const pub = (r.aux.publishedAt as string | null) ?? ""
      const invPub = pub === "" ? "" : INVERTED + pub
      return [invPub, invertKey(r.key)]
    }),
    relation: (row, sets) =>
      row.aux.categoryId === null || !sets.article_categories.has(row.aux.categoryId as string)
        ? `文章 ${row.key} 的分类 ${row.aux.categoryId} 不存在`
        : null,
  },
  {
    id: "bulletins",
    label: "公告",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        title: String(r.title ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
        publishedAt: normWall(r.publishedAt),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        title: String(r.title ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
        publishedAt: normWall(r.publishedAt),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
  },
  {
    id: "ads",
    label: "广告",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        position: String(r.position ?? ""),
        title: String(r.title ?? ""),
        targetUrl: String(r.targetUrl ?? ""),
        imagePath: String(r.imagePath ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: {
        position: String(r.position ?? ""),
        title: String(r.title ?? ""),
        targetUrl: String(r.targetUrl ?? ""),
        imagePath: String(r.imagePath ?? ""),
        sortOrder: normNum(r.sortOrder),
      },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
  },
  {
    id: "site_lines",
    label: "线路",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: { name: String(r.name ?? ""), url: String(r.url ?? ""), sortOrder: normNum(r.sortOrder) },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: { name: String(r.name ?? ""), url: String(r.url ?? ""), sortOrder: normNum(r.sortOrder) },
      aux: { sortOrder: normNum(r.sortOrder) },
    }),
    orderSeq: simpleOrderSeq((r) => [padNum(Number(r.aux.sortOrder ?? 0)), pad(r.key)]),
  },
  {
    id: "site_pages",
    label: "单页",
    snapProject: (r) => ({
      key: String(r.pageKey ?? ""),
      fields: {
        title: String(r.title ?? ""),
        subtitle: String(r.subtitle ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
      },
      aux: {},
    }),
    dbProject: (r) => ({
      key: String(r.pageKey ?? ""),
      fields: {
        title: String(r.title ?? ""),
        subtitle: String(r.subtitle ?? ""),
        contentHtml: String(r.contentHtml ?? ""),
      },
      aux: {},
    }),
    orderSeq: idAsc,
  },
  {
    id: "icon_libraries",
    label: "图标库",
    snapProject: (r) => ({
      key: normId(r.id)!,
      fields: { prefix: String(r.prefix ?? ""), hash: String(r.hash ?? ""), cssPath: String(r.cssPath ?? "") },
      aux: {},
    }),
    dbProject: (r) => ({
      key: normId(r.id)!,
      fields: { prefix: String(r.prefix ?? ""), hash: String(r.hash ?? ""), cssPath: String(r.cssPath ?? "") },
      aux: {},
    }),
    orderSeq: idAsc,
  },
  {
    id: "site_settings",
    label: "站点设置",
    snapProject: (r) => ({
      key: String(r.key ?? ""),
      fields: { value: normJson(r.value) },
      aux: {},
    }),
    dbProject: (r) => ({
      key: String(r.settingKey ?? ""),
      fields: { value: normJson(r.settingValue) },
      aux: {},
    }),
    orderSeq: idAsc,
  },
]

// 倒序排序技巧：逐字符取反，使字典序升序模拟 DB 的 DESC（published_at/id 倒序消费序用）
const INVERTED = Array.from({ length: 128 }, (_, i) => String.fromCharCode(255 - i)).join("")
function invertChars(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c < 128 ? INVERTED[c] : "￿"
  }
  return out
}
function invertKey(id: string): string {
  return invertChars(pad(id))
}

// ── 差异计算 ───────────────────────────────────────────────────────────────

export interface TableDiff {
  tableId: string
  label: string
  snapshotCount: number
  dbCount: number
  /** 快照有、DB 无 */
  missing: string[]
  missingTotal: number
  /** DB 有、快照无 */
  extra: string[]
  extraTotal: number
  /** 两侧都有但字段不一致 */
  changed: string[]
  changedTotal: number
  /** 每行差异字段（与 changed 对齐；字段名 = 快照字段） */
  changedFields: { id: string; fields: string[] }[]
  /** 集合不一致时不评估顺序 → null */
  orderChanged: boolean | null
  orderDiffPositions: number
  relationErrors: string[]
  relationErrorTotal: number
  /** 列表是否因上限被截断 */
  truncated: boolean
  ok: boolean
}

function capList(items: string[], cap = DIFF_LIST_CAP): { list: string[]; total: number } {
  return { list: items.slice(0, cap), total: items.length }
}

/**
 * 单表差异（纯函数）。snapshotRows/dbRows = 各自源的行对象；
 * sets = 关联校验所需的父级键集合（调用方给 DB 键 ∪ 快照键 → 只报真实悬挂引用）。
 */
export function computeTableDiff(
  spec: TableSpec,
  snapshotRows: Rec[],
  dbRows: Rec[],
  sets?: RelationSets,
): TableDiff {
  const projSnap = snapshotRows.map(spec.snapProject)
  const projDb = dbRows.map(spec.dbProject)

  const snapByKey = new Map<string, ProjectedRow>()
  for (const r of projSnap) snapByKey.set(r.key, r)
  const dbByKey = new Map<string, ProjectedRow>()
  const dupDbKeys = new Set<string>()
  for (const r of projDb) {
    if (dbByKey.has(r.key)) dupDbKeys.add(r.key)
    else dbByKey.set(r.key, r)
  }

  const missingKeys = projSnap.filter((r) => !dbByKey.has(r.key)).map((r) => r.key)
  const extraKeys = projDb.filter((r) => !snapByKey.has(r.key)).map((r) => r.key)

  const changedPairs: { id: string; fields: string[] }[] = []
  for (const [id, sr] of snapByKey) {
    const dr = dbByKey.get(id)
    if (!dr) continue
    if (!deepEqual(sr.fields, dr.fields)) {
      const diffFields: string[] = []
      for (const f of Object.keys(sr.fields)) {
        if (!deepEqual(sr.fields[f], dr.fields[f])) diffFields.push(f)
      }
      changedPairs.push({ id, fields: diffFields.slice(0, DIFF_CHANGED_FIELD_CAP) })
    }
  }
  // changedFields 必须与 changed 严格对齐 → 同一排序、同一上限切分
  changedPairs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // 顺序：仅当两侧行集合相等时有意义（缺失/多余会让任何序列比对失真）
  let orderChanged: boolean | null = null
  let orderDiffPositions = 0
  if (missingKeys.length === 0 && extraKeys.length === 0) {
    const seqSnap = spec.orderSeq(projSnap)
    const seqDb = spec.orderSeq(projDb)
    orderChanged = diffPositions(seqSnap, seqDb) > 0
    orderDiffPositions = diffPositions(seqSnap, seqDb)
  }

  // 关联完整性（DB 行 + 快照行两侧都查；FK 已挡住大多数，此处为防御性核验）
  const relationErrors: string[] = []
  if (spec.relation && sets) {
    for (const r of projDb) {
      const e = spec.relation(r, sets)
      if (e) relationErrors.push(`DB: ${e}`)
    }
    for (const r of projSnap) {
      const e = spec.relation(r, sets)
      if (e) relationErrors.push(`快照: ${e}`)
    }
  }
  for (const k of dupDbKeys) relationErrors.push(`DB: ${k} 自然键重复`)

  const missing = capList([...new Set(missingKeys)].sort())
  const extra = capList([...new Set(extraKeys)].sort())
  const changed = capList(changedPairs.map((p) => p.id)) // 已按 id 排序
  const rel = capList(relationErrors)
  const cf = changedPairs.slice(0, DIFF_LIST_CAP)

  const ok =
    missing.total === 0 &&
    extra.total === 0 &&
    changed.total === 0 &&
    (orderChanged === null || orderChanged === false) &&
    rel.total === 0

  return {
    tableId: spec.id,
    label: spec.label,
    snapshotCount: projSnap.length,
    dbCount: projDb.length,
    missing: missing.list,
    missingTotal: missing.total,
    extra: extra.list,
    extraTotal: extra.total,
    changed: changed.list,
    changedTotal: changed.total,
    changedFields: cf,
    orderChanged,
    orderDiffPositions,
    relationErrors: rel.list,
    relationErrorTotal: rel.total,
    truncated:
      missing.total > missing.list.length ||
      extra.total > extra.list.length ||
      changed.total > changed.list.length ||
      rel.total > rel.list.length ||
      changedPairs.length > cf.length,
    ok,
  }
}
