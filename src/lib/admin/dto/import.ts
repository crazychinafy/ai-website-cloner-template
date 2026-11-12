// P7：导入管理 DTO（BIGINT 一律十进制字符串；errorSummary 已脱敏截断）
import type { TableDiff } from "@/lib/admin/import/import-compare"

export interface ImportRunDto {
  id: string
  snapshotVersion: string
  mode: "dry_run" | "import"
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled"
  checksum: string | null
  /** 发起人用户 ID；CLI 触发 = null（无管理员上下文） */
  startedBy: string | null
  /** 发起人用户名；startedBy 非空但用户已删 → null（UI 显示「已删除管理员」） */
  startedByUsername: string | null
  startedByDeleted: boolean
  startedAt: string
  finishedAt: string | null
  /** 脱敏 + 截断后的失败摘要；成功记录为 null */
  errorSummary: string | null
  /** 解析后的 summary_json（counts/total）；解析失败为 null（不阻塞列表） */
  summary: { counts?: Record<string, number>; total?: number } | null
}

/** 单表差异（DTO 复用 import-compare 的 TableDiff 结构，JSON 可序列化） */
export type ImportTableDiffDto = TableDiff

export interface ImportPreviewDto {
  /** 服务端当前加载的快照版本（客户端不可指定） */
  snapshotVersion: string
  /** 服务端实时计算的快照 checksum */
  checksum: string
  /** 服务端连接的目标库名（二次确认的输入参照；不含凭据） */
  targetDatabase: string
  /** 快照总行数 */
  snapshotTotal: number
  /** 内容表现状 */
  dbTotal: number
  dbState: "empty" | "populated"
  /** 当前状态能否执行导入（预览通过 = 执行前置条件之一） */
  executable: boolean
  /** 不可执行原因（可执行时为 null） */
  blockedReason: string | null
  /** 与「上次成功记录」的关系 */
  priorSucceeded: { id: string; checksum: string; startedAt: string } | null
  /** true = 执行将命中安全 no-op（同版本同 checksum 已成功导入过） */
  noOpMatched: boolean
  /** 生产环境是否被允许（ADMIN_IMPORT_ALLOW_PRODUCTION） */
  productionAllowed: boolean
  isProduction: boolean
  /** 13 表差异明细（missing/extra/changed/order_changed/relation_error） */
  tables: ImportTableDiffDto[]
  /** 任一表差异列表被上限截断 */
  anyTruncated: boolean
  /** 预览生成时间（服务端 UTC 墙钟） */
  generatedAt: string
}

export interface ImportExecuteDto {
  outcome: "imported" | "no_op"
  /** imported：本次导入的 admin_import_runs#id；no_op：null */
  runId: string | null
  /** no_op：命中的历史成功记录 ID（不能假装没有发生） */
  noOpRunId: string | null
  snapshotVersion: string
  checksum: string
  counts: Record<string, number> | null
  total: number
  /** 面向管理员的结果说明（含历史记录引用） */
  message: string
}
