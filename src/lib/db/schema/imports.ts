// 静态数据导入运行记录（dry-run 与正式导入均留痕）
import { sql } from "drizzle-orm"
import { bigint, char, datetime, index, json, mysqlEnum, mysqlTable, text, varchar } from "drizzle-orm/mysql-core"
import { adminUsers } from "./admin.ts"

export const adminImportRuns = mysqlTable(
  "admin_import_runs",
  {
    id: bigint("id", { mode: "bigint", unsigned: true }).autoincrement().primaryKey(),
    snapshotVersion: varchar("snapshot_version", { length: 100 }).notNull(),
    mode: mysqlEnum("mode", ["dry_run", "import"]).notNull(),
    status: mysqlEnum("status", ["pending", "running", "succeeded", "failed", "cancelled"]).notNull(),
    summaryJson: json("summary_json"),
    checksum: char("checksum", { length: 64 }),
    startedBy: bigint("started_by", { mode: "bigint", unsigned: true }).references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    startedAt: datetime("started_at", { mode: "string", fsp: 3 }).notNull().default(
      sql`CURRENT_TIMESTAMP(3)`,
    ),
    finishedAt: datetime("finished_at", { mode: "string", fsp: 3 }),
    errorSummary: text("error_summary"),
  },
  (t) => [index("idx_admin_import_runs_status_time").on(t.status, t.startedAt)],
)

export type AdminImportRun = typeof adminImportRuns.$inferSelect
