// P7 测试：导入差异引擎（import-compare，纯函数，无 DB）
// - missing / extra / changed / order_changed / relation_error 五类差异语义
// - 集合不一致时不评估顺序（orderChanged = null）
// - 列表上限 DIFF_LIST_CAP=100、字段上限 DIFF_CHANGED_FIELD_CAP=30、truncated 标志
// - DB 自然键重复 → 关系错误；关系校验同时覆盖 DB 行与快照行
import { describe, expect, it } from "vitest"
import {
  DIFF_CHANGED_FIELD_CAP,
  DIFF_LIST_CAP,
  IMPORT_TABLE_SPECS,
  computeTableDiff,
  diffPositions,
  type Rec,
  type RelationSets,
  type TableSpec,
} from "../../src/lib/admin/import/import-compare.ts"

const LINK_CATS: TableSpec = IMPORT_TABLE_SPECS.find((s) => s.id === "link_categories")!
const ARTICLE_CATS: TableSpec = IMPORT_TABLE_SPECS.find((s) => s.id === "article_categories")!
const ARTICLES: TableSpec = IMPORT_TABLE_SPECS.find((s) => s.id === "articles")!

const cat = (id: string, name: string, opts: { parentId?: string | null; sortOrder?: number; iconClass?: string } = {}): Rec => ({
  id,
  parentId: opts.parentId ?? null,
  name,
  iconClass: opts.iconClass ?? "icon-uni",
  sortOrder: opts.sortOrder ?? 0,
})

const emptySets = (linkKeys: string[] = [], articleKeys: string[] = []): RelationSets => ({
  link_categories: new Set(linkKeys),
  article_categories: new Set(articleKeys),
  site_tags: new Set(),
  site_links: new Set(),
})

describe("computeTableDiff：集合差异", () => {
  it("完全一致 → ok，orderChanged=false，无差异", () => {
    const rows = [cat("1", "A"), cat("2", "B", { parentId: "1" })]
    const d = computeTableDiff(LINK_CATS, rows, rows.map((r) => ({ ...r })))
    expect(d.ok).toBe(true)
    expect(d.tableId).toBe("link_categories")
    expect(d.label).toBe("网址分类")
    expect(d.snapshotCount).toBe(2)
    expect(d.dbCount).toBe(2)
    expect(d.missingTotal).toBe(0)
    expect(d.extraTotal).toBe(0)
    expect(d.changedTotal).toBe(0)
    expect(d.orderChanged).toBe(false)
    expect(d.orderDiffPositions).toBe(0)
    expect(d.relationErrorTotal).toBe(0)
    expect(d.truncated).toBe(false)
  })

  it("快照有 DB 无 → missing；DB 有快照无 → extra；两侧同时存在时 orderChanged=null", () => {
    const snap = [cat("1", "A"), cat("3", "C")]
    const db = [cat("1", "A"), cat("9", "旧遗留")]
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.missing).toEqual(["3"])
    expect(d.missingTotal).toBe(1)
    expect(d.extra).toEqual(["9"])
    expect(d.extraTotal).toBe(1)
    expect(d.changedTotal).toBe(0)
    // 集合都不相等 → 顺序比对失真，必须给 null 而不是猜测
    expect(d.orderChanged).toBeNull()
    expect(d.ok).toBe(false)
  })

  it("同键字段不同 → changed + changedFields 精确到字段名", () => {
    const snap = [cat("7", "新名", { sortOrder: 5, iconClass: "icon-new" })]
    const db = [cat("7", "旧名", { sortOrder: 5, iconClass: "icon-new" })]
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.changed).toEqual(["7"])
    expect(d.changedTotal).toBe(1)
    expect(d.changedFields).toEqual([{ id: "7", fields: ["name"] }])
    expect(d.orderChanged).toBe(false) // 集合相同，顺序仍评估
    expect(d.ok).toBe(false)
  })

  it("类型形态差异不影响判定（BIGINT 字符串 vs 数字、null vs undefined）", () => {
    const snap = [{ id: 1, parentId: undefined, name: "A", iconClass: "i", sortOrder: "3" }]
    const db = [{ id: "1", parentId: null, name: "A", iconClass: "i", sortOrder: 3 }]
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.changedTotal).toBe(0)
    expect(d.ok).toBe(true)
  })

  it("字段数超过 DIFF_CHANGED_FIELD_CAP → fields 截断到 30", () => {
    const FIELD_NAMES = Array.from({ length: 40 }, (_, i) => `f${i}`)
    const project = (r: Rec) => ({
      key: String(r.id),
      fields: Object.fromEntries(FIELD_NAMES.map((f) => [f, r[f]])),
      aux: {},
    })
    const wide: TableSpec = {
      id: "wide",
      label: "宽表",
      snapProject: project,
      dbProject: project,
      orderSeq: (rows) => rows.map((r) => r.key).sort(),
    }
    const snap: Rec = { id: "1", ...Object.fromEntries(FIELD_NAMES.map((f) => [f, `s-${f}`])) }
    const db: Rec = { id: "1", ...Object.fromEntries(FIELD_NAMES.map((f) => [f, `d-${f}`])) }
    const d = computeTableDiff(wide, [snap], [db])
    expect(d.changedTotal).toBe(1)
    expect(d.changedFields[0].fields.length).toBe(DIFF_CHANGED_FIELD_CAP)
  })
})

describe("computeTableDiff：顺序（前台消费序）", () => {
  it("同集合、排序字段互换 → 字段差异 + orderChanged=true（顺序键全部是被比较字段）", () => {
    const snap = [cat("1", "A", { sortOrder: 1 }), cat("2", "B", { sortOrder: 2 })]
    const db = [cat("1", "A", { sortOrder: 2 }), cat("2", "B", { sortOrder: 1 })]
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.missingTotal).toBe(0)
    expect(d.extraTotal).toBe(0)
    expect(d.changedTotal).toBe(2)
    expect(d.changedFields).toEqual([
      { id: "1", fields: ["sortOrder"] },
      { id: "2", fields: ["sortOrder"] },
    ])
    expect(d.orderChanged).toBe(true)
    expect(d.orderDiffPositions).toBe(2)
    expect(d.ok).toBe(false)
  })

  it("父子前序：子级紧跟父级（同集合、前序一致 → orderChanged=false）", () => {
    const snap = [cat("1", "父", { sortOrder: 1 }), cat("2", "子", { parentId: "1", sortOrder: 9 })]
    // DB 数组顺序不同但前序序列一致（子级仍紧跟父级）
    const db = [cat("2", "子", { parentId: "1", sortOrder: 9 }), cat("1", "父", { sortOrder: 1 })]
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.orderChanged).toBe(false)
  })

  it("线性表（article_categories）按 (sortOrder,id) 比对", () => {
    const row = (id: string, sortOrder: number): Rec => ({ id, name: `n${id}`, iconClass: "i", sortOrder })
    const same = computeTableDiff(ARTICLE_CATS, [row("1", 1), row("2", 2)], [row("2", 2), row("1", 1)])
    expect(same.orderChanged).toBe(false) // 集合与序列一致（DB 数组乱序不影响消费序）
    const swapped = computeTableDiff(ARTICLE_CATS, [row("1", 1), row("2", 2)], [row("1", 2), row("2", 1)])
    expect(swapped.changedTotal).toBe(2) // sortOrder 本身就是字段差异
    expect(swapped.orderChanged).toBe(true)
  })

  it("文章按 published_at DESC + id DESC 消费序（快照 sourceUpdatedAt ↔ DB updated_at）", () => {
    const art = (id: string, publishedAt: string, updatedAt = "2026-01-01 00:00:00"): Rec => ({
      id,
      categoryId: "10",
      title: `t${id}`,
      contentHtml: "c",
      coverImage: "",
      categoryNameSnapshot: "cat",
      seoTitle: "",
      seoKeywords: "",
      seoDescription: "",
      viewCount: "0",
      authorName: "a",
      authorAvatar: "",
      publishedAt,
      updatedAt,
      sourceUpdatedAt: updatedAt,
    })
    const snap = [art("1", "2026-01-01 10:00:00"), art("2", "2026-02-01 10:00:00")]
    // 消费序由字段值排序决定：DB 行数组顺序不同不影响判定
    const d1 = computeTableDiff(ARTICLES, snap, [art("2", "2026-02-01 10:00:00"), art("1", "2026-01-01 10:00:00")], emptySets([], ["10"]))
    expect(d1.ok).toBe(true)
    expect(d1.orderChanged).toBe(false)
    const d2 = computeTableDiff(ARTICLES, snap, [art("1", "2026-02-01 10:00:00"), art("2", "2026-01-01 10:00:00")], emptySets([], ["10"]))
    expect(d2.changed).toEqual(["1", "2"])
    expect(d2.changedFields).toEqual([
      { id: "1", fields: ["publishedAt"] },
      { id: "2", fields: ["publishedAt"] },
    ])
    expect(d2.orderChanged).toBe(true)
    // 快照 sourceUpdatedAt ↔ DB updated_at 无损映射：取值不同即 updatedAt 差异
    const d3 = computeTableDiff(
      ARTICLES,
      [art("1", "2026-01-01 10:00:00", "2026-03-01 00:00:00")],
      [art("1", "2026-01-01 10:00:00", "2026-04-01 00:00:00")],
      emptySets([], ["10"]),
    )
    expect(d3.changedFields).toEqual([{ id: "1", fields: ["updatedAt"] }])
  })
})

describe("computeTableDiff：关联完整性", () => {
  it("DB 行悬挂父级 → 「DB: …」关系错误", () => {
    const db = [cat("5", "孤儿", { parentId: "404" })]
    const d = computeTableDiff(LINK_CATS, [], db, emptySets(["5"]))
    expect(d.relationErrorTotal).toBe(1)
    expect(d.relationErrors[0]).toContain("DB:")
    expect(d.relationErrors[0]).toContain("404")
    expect(d.ok).toBe(false)
  })

  it("快照行悬挂分类 → 「快照: …」关系错误（文章 → 文章分类）", () => {
    const art = (id: string, categoryId: string | null): Rec => ({
      id,
      categoryId,
      title: "t",
      contentHtml: "c",
      coverImage: "",
      categoryNameSnapshot: "",
      seoTitle: "",
      seoKeywords: "",
      seoDescription: "",
      viewCount: "1",
      authorName: "a",
      authorAvatar: "",
      publishedAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
      sourceUpdatedAt: "2026-01-01 00:00:00",
    })
    const d = computeTableDiff(ARTICLES, [art("1", "999")], [], emptySets([], ["10"]))
    expect(d.relationErrorTotal).toBe(1)
    expect(d.relationErrors[0]).toContain("快照:")
    // categoryId=null 也算关系错误（文章必须有分类）
    const d2 = computeTableDiff(ARTICLES, [art("2", null)], [], emptySets([], ["10"]))
    expect(d2.relationErrors[0]).toContain("null")
  })

  it("site_links：tagId 悬挂 → 关系错误；tagId 可空 / 有效 → 无关系错误（aux 必须带 tagId）", () => {
    const SITE_LINKS: TableSpec = IMPORT_TABLE_SPECS.find((s) => s.id === "site_links")!
    const link = (id: string, categoryId: string | null, tagId: string | null): Rec => ({
      id,
      categoryId,
      tagId,
      title: "t",
      url: "https://example.com",
      description: "",
      logoPath: "",
      isGone: 0,
      sortOrder: 0,
    })
    const sets: RelationSets = {
      link_categories: new Set(["1"]),
      article_categories: new Set(),
      site_tags: new Set(["7"]),
      site_links: new Set(),
    }
    // 有效 tag + 无 tag（NULL）都是合法行 —— 曾因 aux 缺 tagId（undefined ≠ null）全量误报
    const okRows = [link("11", "1", "7"), link("12", "1", null)]
    const dOk = computeTableDiff(SITE_LINKS, okRows, [], sets)
    expect(dOk.relationErrorTotal).toBe(0)
    // 悬挂 tag
    const dBad = computeTableDiff(SITE_LINKS, [link("13", "1", "404")], [], sets)
    expect(dBad.relationErrorTotal).toBe(1)
    expect(dBad.relationErrors[0]).toContain("404")
    // categoryId=null：链接必须有分类
    const dNull = computeTableDiff(SITE_LINKS, [link("14", null, null)], [], sets)
    expect(dNull.relationErrors[0]).toContain("分类 null")
  })

  it("DB 自然键重复 → 关系错误（第二行不计入 changed，改报重复）", () => {
    const db = [cat("3", "A"), cat("3", "B")] // 同 id 不同名（理论不可能，防御性）
    const snap = [cat("3", "A")]
    const d = computeTableDiff(LINK_CATS, snap, db, emptySets(["3"]))
    expect(d.dbCount).toBe(2)
    expect(d.relationErrorTotal).toBe(1)
    expect(d.relationErrors[0]).toContain("自然键重复")
    expect(d.ok).toBe(false)
  })
})

describe("computeTableDiff：上限与 truncated", () => {
  it(`missing 超过 ${DIFF_LIST_CAP} → 列表截断、total 保真、truncated=true`, () => {
    const snap = Array.from({ length: DIFF_LIST_CAP + 50 }, (_, i) => cat(String(i + 1), `c${i}`))
    const d = computeTableDiff(ARTICLE_CATS, snap.map((r) => ({ id: r.id, name: r.name, iconClass: r.iconClass, sortOrder: r.sortOrder })), [])
    expect(d.missingTotal).toBe(DIFF_LIST_CAP + 50)
    expect(d.missing.length).toBe(DIFF_LIST_CAP)
    expect(d.truncated).toBe(true)
    expect(d.changedFields.length).toBeLessThanOrEqual(DIFF_LIST_CAP)
  })

  it("changedFields 与 changed 对齐且同样受 100 上限约束", () => {
    const n = DIFF_LIST_CAP + 10
    const snap = Array.from({ length: n }, (_, i) => cat(String(i + 1), `新${i}`))
    const db = Array.from({ length: n }, (_, i) => cat(String(i + 1), `旧${i}`))
    const d = computeTableDiff(LINK_CATS, snap, db)
    expect(d.changedTotal).toBe(n)
    expect(d.changed.length).toBe(DIFF_LIST_CAP)
    expect(d.changedFields.length).toBe(DIFF_LIST_CAP)
    // 展示项都能在对齐表里找到对应字段集合
    const byId = new Map(d.changedFields.map((c) => [c.id, c.fields]))
    for (const id of d.changed) expect(byId.get(id)).toEqual(["name"])
    expect(d.truncated).toBe(true)
  })

  it("关系错误同样截断（>100 条）", () => {
    const db = Array.from({ length: DIFF_LIST_CAP + 20 }, (_, i) => cat(String(i + 1), `c${i}`, { parentId: "404" }))
    const d = computeTableDiff(LINK_CATS, [], db, emptySets(db.map((r) => String(r.id))))
    expect(d.relationErrorTotal).toBe(DIFF_LIST_CAP + 20)
    expect(d.relationErrors.length).toBe(DIFF_LIST_CAP)
    expect(d.truncated).toBe(true)
  })
})

describe("diffPositions", () => {
  it("返回差异位置数（不是下标）", () => {
    expect(diffPositions(["a", "b"], ["a", "b"])).toBe(0)
    expect(diffPositions(["a", "b"], ["a", "x"])).toBe(1)
    expect(diffPositions(["a", "b", "c"], ["c", "b", "a"])).toBe(2)
    expect(diffPositions(["a"], [])).toBe(1)
    expect(diffPositions([], [])).toBe(0)
  })
})
