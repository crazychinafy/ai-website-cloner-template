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
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
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
