// 网址主表 + 详情（可选 1:1）+ 备用链接（1:N）
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"
import { linkCategories } from "./categories.ts"
import { siteTags } from "./tags.ts"

export const siteLinks = mysqlTable(
  "site_links",
  {
    // P6B：BIGINT 主键启用 AUTO_INCREMENT（migration 0003）；静态快照仍显式写入原始 17/18 位 ID
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().autoincrement().primaryKey(),
    categoryId: bigint("category_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => linkCategories.id, { onDelete: "restrict" }),
    tagId: bigint("tag_id", { mode: "bigint", unsigned: true }).references(() => siteTags.id, {
      onDelete: "restrict",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    description: text("description").notNull(),
    logoPath: varchar("logo_path", { length: 1024 }).notNull().default(""),
    isGone: boolean("is_gone").notNull().default(false),
    status: mysqlEnum("status", ["draft", "published", "disabled"]).notNull().default("published"),
    sortOrder: int("sort_order").notNull().default(0),
    // P8-0：标签页网格规范序 —— 所属标签组内稠密排名（0..n-1，= TAG_ORDER 序列 + 档案序追加，
    // 与分类页 sort_order 同构；tag_id 为 NULL 或未经导入/回填/后台维护的行可为 NULL → 标签页按 id 序附后）
    tagSortOrder: int("tag_sort_order"),
    // P8：首页分组 + 搜索候选规范序 = 源档案（ALL_LINKS 快照插入序）全局稠密下标（0..n-1）。
    // 该序无法由 (sort_order,id) 复现（45/90 分类内档案序 ≠ 分类规范序），必须显式存储；
    // 快照/checksum 形态不变，导入插入期按快照数组下标写入；后台新建行 NULL → 首页/搜索按 id 序附后
    archiveSortOrder: int("archive_sort_order"),
    sourceSnapshot: boolean("source_snapshot").notNull().default(true),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [
    index("idx_site_links_category_status_sort").on(t.categoryId, t.status, t.deletedAt, t.sortOrder),
    index("idx_site_links_tag_status").on(t.tagId, t.status, t.deletedAt),
    // P8-0：标签页查询 (tag_id, status, deleted_at) 过滤后按 (tag_sort_order, id) 消费序直接走索引
    index("idx_site_links_tag_sort").on(t.tagId, t.status, t.deletedAt, t.tagSortOrder, t.id),
    index("idx_site_links_updated").on(t.updatedAt),
  ],
)

export const siteLinkDetails = mysqlTable("site_link_details", {
  linkId: bigint("link_id", { mode: "bigint", unsigned: true })
    .notNull()
    .primaryKey()
    .references(() => siteLinks.id, { onDelete: "cascade" }),
  clickCount: bigint("click_count", { mode: "bigint", unsigned: true }).notNull().default(sql`0`),
  likeCount: bigint("like_count", { mode: "bigint", unsigned: true }).notNull().default(sql`0`),
  annotation: varchar("annotation", { length: 500 }).notNull().default(""),
  previewImage: varchar("preview_image", { length: 1024 }).notNull().default(""),
  detailHtml: longtext("detail_html").notNull(),
  sourceCreatedAt: datetime("source_created_at", { mode: "string", fsp: 3 }),
  sourceUpdatedAt: datetime("source_updated_at", { mode: "string", fsp: 3 }),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
})

export const siteLinkMirrors = mysqlTable(
  "site_link_mirrors",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    linkId: bigint("link_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => siteLinks.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("idx_site_link_mirrors_link_sort").on(t.linkId, t.sortOrder)],
)

export type SiteLink = typeof siteLinks.$inferSelect
export type SiteLinkDetail = typeof siteLinkDetails.$inferSelect
export type SiteLinkMirror = typeof siteLinkMirrors.$inferSelect
