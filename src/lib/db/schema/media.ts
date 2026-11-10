// 媒体资源：只存元数据（文件本体在独立持久化目录/对象存储，数据库不存 BLOB）
import { sql } from "drizzle-orm"
import { bigint, char, datetime, index, int, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

export const mediaAssets = mysqlTable(
  "media_assets",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    storageKey: varchar("storage_key", { length: 512 }).notNull().unique("uq_media_storage_key"),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint", unsigned: true }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    width: int("width", { unsigned: true }),
    height: int("height", { unsigned: true }),
    uploadedBy: bigint("uploaded_by", { mode: "bigint", unsigned: true }).references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("idx_media_sha256").on(t.sha256)],
)

export type MediaAsset = typeof mediaAssets.$inferSelect
