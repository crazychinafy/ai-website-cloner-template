// 文章（正文 LONGTEXT、SEO 字段、浏览量、草稿/发布/归档）
import {
  bigint,
  datetime,
  index,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"
import { articleCategories } from "./categories.ts"

export const articles = mysqlTable(
  "articles",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).notNull().primaryKey(),
    categoryId: bigint("category_id", { mode: "bigint", unsigned: true })
      .notNull()
      .references(() => articleCategories.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 500 }).notNull(),
    contentHtml: longtext("content_html").notNull(),
    coverImage: varchar("cover_image", { length: 1024 }).notNull().default(""),
    categoryNameSnapshot: varchar("category_name_snapshot", { length: 120 }).notNull().default(""),
    seoTitle: varchar("seo_title", { length: 500 }).notNull().default(""),
    seoKeywords: varchar("seo_keywords", { length: 1000 }).notNull().default(""),
    seoDescription: varchar("seo_description", { length: 1000 }).notNull().default(""),
    viewCount: bigint("view_count", { mode: "bigint", unsigned: true }).notNull().default(sql`0`),
    authorName: varchar("author_name", { length: 120 }).notNull().default(""),
    authorAvatar: varchar("author_avatar", { length: 1024 }).notNull().default(""),
    status: mysqlEnum("status", ["draft", "published", "archived"]).notNull().default("published"),
    publishedAt: datetime("published_at", { mode: "string", fsp: 3 }),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    deletedAt: datetime("deleted_at", { mode: "string", fsp: 3 }),
  },
  (t) => [
    index("idx_articles_category_status_date").on(t.categoryId, t.status, t.deletedAt, t.publishedAt),
    index("idx_articles_status_created").on(t.status, t.deletedAt, t.createdAt),
  ],
)

export type Article = typeof articles.$inferSelect
