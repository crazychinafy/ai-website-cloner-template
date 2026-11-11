// P6A §14.1 数据校验测试：Zod 合同（ID/列表参数/字段构件/三资源 schema/版本参数）
import { describe, expect, it } from "vitest"
import {
  bigintIdSchema,
  makeListQuerySchema,
  parseVersionParam,
  searchParamsRecord,
} from "../../src/lib/admin/validation/list-query.ts"
import {
  hexColorSchema,
  iconClassSchema,
  nameSchema,
  reorderItemsSchema,
  sortOrderSchema,
  statusChangeSchema,
  versionBodySchema,
} from "../../src/lib/admin/validation/content-fields.ts"
import {
  categoryListQuerySchema,
  categoryTreeQuerySchema,
  createCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from "../../src/lib/admin/validation/category-schema.ts"
import { createArticleCategorySchema } from "../../src/lib/admin/validation/article-category-schema.ts"
import { createTagSchema, updateTagSchema } from "../../src/lib/admin/validation/tag-schema.ts"
import { ContentError } from "../../src/lib/admin/validation/content-error.ts"

describe("P6A §14.1 非法 ID / 排序字段", () => {
  it("BIGINT 十进制字符串 ID 通过；非法形态全部拒绝", () => {
    for (const good of ["1", "9", "790624444806041600", "9223372036854775807", "18446744073709551615"]) {
      expect(bigintIdSchema.safeParse(good).success, good).toBe(true)
    }
    for (const bad of ["", "0", "01", "abc", "12.5", "-3", "1e18", "9".repeat(21), " 7", "7 ", "NaN"]) {
      expect(bigintIdSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it("列表 sortBy 白名单：白名单外字段 → 422（绝不透传 SQL）", () => {
    const schema = makeListQuerySchema({
      sortFields: ["sortOrder", "name", "id", "createdAt"] as const,
      defaultSortBy: "sortOrder",
    })
    expect(schema.safeParse({ sortBy: "name" }).success).toBe(true)
    for (const bad of ["password", "id; DROP TABLE", "sort_order", ""]) {
      expect(schema.safeParse({ sortBy: bad }).success, bad).toBe(false)
    }
  })

  it("pageSize 只允许 20/50/100；page 必填范围", () => {
    const schema = makeListQuerySchema({ sortFields: ["id"] as const, defaultSortBy: "id" })
    for (const n of [20, 50, 100]) expect(schema.safeParse({ pageSize: String(n) }).success, String(n)).toBe(true)
    for (const bad of ["30", "0", "101", "abc", "20.5"]) {
      expect(schema.safeParse({ pageSize: bad }).success, bad).toBe(false)
    }
    expect(schema.safeParse({ page: "0" }).success).toBe(false)
    const d = schema.safeParse({})
    expect(d.success && d.data.pageSize === 20 && d.data.page === 1).toBe(true)
  })

  it("分类列表 parentId=none 与 includeDeleted 互斥（§9.1）", () => {
    expect(categoryListQuerySchema.safeParse({ parentId: "none" }).success).toBe(true)
    expect(categoryListQuerySchema.safeParse({ parentId: "790624444806041600" }).success).toBe(true)
    const both = categoryListQuerySchema.safeParse({ parentId: "none", includeDeleted: "true" })
    expect(both.success).toBe(false)
    expect(categoryListQuerySchema.safeParse({ includeDeleted: "maybe" }).success).toBe(false)
  })

  it("DELETE ?version= 缺失/非法 → ContentError 422", () => {
    expect(parseVersionParam(new Request("http://x/y?version=3"))).toBe(3)
    for (const url of ["http://x/y", "http://x/y?version=0", "http://x/y?version=x", "http://x/y?version=-2"]) {
      try {
        parseVersionParam(new Request(url))
        expect.unreachable(url)
      } catch (e) {
        expect(e).toBeInstanceOf(ContentError)
        expect((e as ContentError).status).toBe(422)
        expect((e as ContentError).code).toBe("VALIDATION_ERROR")
      }
    }
  })

  it("searchParamsRecord 重复参数取首个、供 Zod 校验", () => {
    const sp = new URLSearchParams("page=2&page=9&zz=")
    expect(searchParamsRecord(sp)).toEqual({ page: "2", zz: "" })
  })
})

describe("P6A §14.1 字段构件", () => {
  const name = nameSchema(120, "分类名称")

  it("名称：必填/trim/长度（中文按字符数）", () => {
    expect(name.safeParse("  财经  ").success).toBe(true)
    expect(name.safeParse("").success).toBe(false)
    expect(name.safeParse("   ").success).toBe(false)
    expect(name.safeParse("名".repeat(120)).success).toBe(true)
    expect(name.safeParse("名".repeat(121)).success).toBe(false)
  })

  it("iconClass：源站多 class 通过；注入形态全部拒绝", () => {
    for (const good of ["", "iconfont", "il7e7595cf1d30 iconfont icon-USDT", "a_b-c"]) {
      expect(iconClassSchema.safeParse(good).success, good).toBe(true)
    }
    for (const bad of ["<script>alert(1)</script>", 'a" style="x:y', "a;b", "a(b)", "1abc", "a\nb"]) {
      expect(iconClassSchema.safeParse(bad).success, bad).toBe(false)
    }
    // tab 分隔 + 首尾空白：trim 后是合法 token 序列（源站形态兼容）
    expect(iconClassSchema.safeParse("a\tb\t").success).toBe(true)
  })

  it("sortOrder：非负整数 INT 范围", () => {
    for (const good of [0, 1, 2_147_483_647]) expect(sortOrderSchema.safeParse(good).success, String(good)).toBe(true)
    for (const bad of [-1, 2_147_483_648, 1.5, Number.NaN]) expect(sortOrderSchema.safeParse(bad).success, String(bad)).toBe(false)
  })

  it("hexColor：#RRGGBB，统一小写；非法颜色拒绝", () => {
    const p = hexColorSchema.safeParse(" #FF0000 ")
    expect(p.success && p.data === "#ff0000").toBe(true)
    for (const bad of ["red", "#FFF", "#GGGGGG", "rgb(1,2,3)", ""]) {
      expect(hexColorSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it("statusChange / version 体：字段必填", () => {
    expect(statusChangeSchema.safeParse({ status: "disabled", version: 2 }).success).toBe(true)
    expect(statusChangeSchema.safeParse({ status: "archived", version: 2 }).success).toBe(false)
    expect(statusChangeSchema.safeParse({ status: "disabled" }).success).toBe(false)
    expect(versionBodySchema.safeParse({ version: 1 }).success).toBe(true)
    expect(versionBodySchema.safeParse({ version: 0 }).success).toBe(false)
    expect(versionBodySchema.safeParse({ version: 1, extra: true }).success).toBe(true) // 非 strict：未知键剥离
  })

  it("reorder items：至少 1 条、id 不得重复", () => {
    const ok = reorderItemsSchema.safeParse([
      { id: "10", sortOrder: 0, version: 1 },
      { id: "11", sortOrder: 1, version: 2 },
    ])
    expect(ok.success).toBe(true)
    expect(reorderItemsSchema.safeParse([]).success).toBe(false)
    const dup = reorderItemsSchema.safeParse([
      { id: "10", sortOrder: 0, version: 1 },
      { id: "10", sortOrder: 1, version: 1 },
    ])
    expect(dup.success).toBe(false)
  })
})

describe("P6A §14.1 三资源 create/update schema", () => {
  it("分类 create/update：parentId 形态与 version 必填", () => {
    expect(createCategorySchema.safeParse({ name: "A" }).success).toBe(true)
    expect(createCategorySchema.safeParse({ name: "A", parentId: null }).success).toBe(true)
    expect(createCategorySchema.safeParse({ name: "A", parentId: "790624444806041600" }).success).toBe(true)
    expect(createCategorySchema.safeParse({ name: "A", parentId: "none" }).success).toBe(false)
    expect(createCategorySchema.safeParse({ parentId: "1" }).success).toBe(false) // 缺 name
    // update：只传 version = 没有要改的字段
    expect(updateCategorySchema.safeParse({ version: 1 }).success).toBe(false)
    expect(updateCategorySchema.safeParse({ parentId: null, version: 1 }).success).toBe(true)
  })

  it("分类 reorder 必须声明 parentId 作用域", () => {
    expect(reorderCategoriesSchema.safeParse({ parentId: null, items: [{ id: "1", sortOrder: 0, version: 1 }] }).success).toBe(true)
    expect(reorderCategoriesSchema.safeParse({ items: [{ id: "1", sortOrder: 0, version: 1 }] }).success).toBe(false)
  })

  it("文章分类/标签 create 必填与枚举", () => {
    expect(createArticleCategorySchema.safeParse({ name: "公告" }).success).toBe(true)
    expect(createArticleCategorySchema.safeParse({ name: "" }).success).toBe(false)
    expect(createTagSchema.safeParse({ name: "正规" }).success).toBe(true)
    expect(createTagSchema.safeParse({ name: "t", color: "teal" }).success).toBe(false)
    expect(updateTagSchema.safeParse({ version: 1 }).success).toBe(false)
    expect(updateTagSchema.safeParse({ color: "#000000", version: 1 }).success).toBe(true)
  })

  it("树查询：仅 q/status 两个可选参数", () => {
    expect(categoryTreeQuerySchema.safeParse({}).success).toBe(true)
    expect(categoryTreeQuerySchema.safeParse({ q: "财经", status: "active" }).success).toBe(true)
    expect(categoryTreeQuerySchema.safeParse({ status: "on" }).success).toBe(false)
  })
})
