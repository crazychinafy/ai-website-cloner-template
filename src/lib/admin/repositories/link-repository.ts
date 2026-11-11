// P6B：网址管理 Repository（唯一允许直接接触 site_links / site_link_details / site_link_mirrors 的模块）
// ─────────────────────────────────────────────────────────────────
// - 同 category-repository 约定：Executor（池或事务）；BIGINT 入参已是校验过的十进制字符串；
//   关联子查询里外层列必须 sql.raw 显式限定表名（否则绑定到子查询自身）
// - 列表附带 categoryName/tagName/clickCount（相关子查询；3.8k 行毫秒级）
// - 备用链接的增删改全部带 link_id 条件（归属防呆：跨网址 ID 永远改不动别人的行）
import "server-only"
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm"
import { linkCategories, siteLinkDetails, siteLinkMirrors, siteLinks, siteTags } from "@/lib/db/schema"
import type { SQL } from "drizzle-orm"
import { asExecutor, lastInsertIdString, type AdminTx, type Executor } from "./executor.ts"
import { likeEscape } from "../validation/list-query.ts"
import type { LinkListQuery } from "../validation/link-schema.ts"
import type { LinkDetailDto, LinkDto, LinkMirrorDto } from "../dto/link.ts"
import { idToString } from "../dto/link.ts"

type LinkRow = typeof siteLinks.$inferSelect

/** 主行 + 页面上需要的关联展示列（分类名/标签名/点击数/有无详情行） */
const selection = {
  row: siteLinks,
  categoryName: sql<unknown>`(select lc.name from ${linkCategories} lc where lc.id = ${sql.raw("`site_links`.`category_id`")})`,
  tagName: sql<unknown>`(select st.name from ${siteTags} st where st.id = ${sql.raw("`site_links`.`tag_id`")})`,
  clickCount: sql<unknown>`(select coalesce((select d.click_count from ${siteLinkDetails} d where d.link_id = ${sql.raw("`site_links`.`id`")}), 0))`,
  hasDetail: sql<unknown>`(select exists(select 1 from ${siteLinkDetails} d2 where d2.link_id = ${sql.raw("`site_links`.`id`")}))`,
}

export function toLinkDto(
  row: LinkRow,
  extras: { categoryName: unknown; tagName: unknown; clickCount: unknown; hasDetail: unknown },
): LinkDto {
  return {
    id: row.id.toString(),
    categoryId: row.categoryId.toString(),
    categoryName: extras.categoryName === null || extras.categoryName === undefined ? null : String(extras.categoryName),
    tagId: idToString(row.tagId),
    tagName: extras.tagName === null || extras.tagName === undefined ? null : String(extras.tagName),
    title: row.title,
    url: row.url,
    description: row.description,
    logoPath: row.logoPath,
    isGone: row.isGone,
    status: row.status,
    sortOrder: row.sortOrder,
    sourceSnapshot: row.sourceSnapshot,
    version: row.version,
    clickCount: Number(extras.clickCount ?? 0),
    hasDetail: Boolean(Number(extras.hasDetail ?? 0)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  }
}

function toDetailDto(row: typeof siteLinkDetails.$inferSelect): LinkDetailDto {
  return {
    linkId: row.linkId.toString(),
    clickCount: Number(row.clickCount),
    likeCount: Number(row.likeCount),
    annotation: row.annotation,
    previewImage: row.previewImage,
    detailHtml: row.detailHtml,
    sourceCreatedAt: row.sourceCreatedAt ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt ?? null,
    updatedAt: row.updatedAt,
  }
}

function toMirrorDto(row: typeof siteLinkMirrors.$inferSelect): LinkMirrorDto {
  return {
    id: row.id.toString(),
    linkId: row.linkId.toString(),
    name: row.name,
    url: row.url,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const SORT_COLS = {
  sortOrder: siteLinks.sortOrder,
  title: siteLinks.title,
  id: siteLinks.id,
  createdAt: siteLinks.createdAt,
  updatedAt: siteLinks.updatedAt,
} as const

/** 列表 where（q 命中标题/地址/简介；categoryId/tagId/status 精确；includeDeleted 控制软删除可见性） */
function buildListWhere(q: LinkListQuery): SQL {
  const conds: (SQL | undefined)[] = []
  if (!q.includeDeleted) conds.push(isNull(siteLinks.deletedAt))
  if (q.q) {
    const t = `%${likeEscape(q.q)}%`
    conds.push(or(like(siteLinks.title, t), like(siteLinks.url, t), like(siteLinks.description, t)))
  }
  if (q.status) conds.push(eq(siteLinks.status, q.status))
  if (q.categoryId) conds.push(eq(siteLinks.categoryId, BigInt(q.categoryId)))
  if (q.tagId) conds.push(eq(siteLinks.tagId, BigInt(q.tagId)))
  return and(...conds) ?? sql`1 = 1`
}

export async function listLinks(exec: Executor, q: LinkListQuery): Promise<{ items: LinkDto[]; total: number }> {
  const db = asExecutor(exec)
  const where = buildListWhere(q)
  const order = q.sortDir === "desc" ? desc(SORT_COLS[q.sortBy]) : asc(SORT_COLS[q.sortBy])
  const rows = await db
    .select(selection)
    .from(siteLinks)
    .where(where)
    .orderBy(order, asc(siteLinks.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  const [cnt] = await db.select({ n: sql<unknown>`count(*)` }).from(siteLinks).where(where)
  return {
    items: rows.map((r) =>
      toLinkDto(r.row, { categoryName: r.categoryName, tagName: r.tagName, clickCount: r.clickCount, hasDetail: r.hasDetail }),
    ),
    total: Number((cnt as { n: unknown }).n ?? 0),
  }
}

/** 按 ID 取主行 DTO（含软删除行；DELETE/编辑后回读用） */
export async function getLinkDto(exec: Executor, id: string): Promise<LinkDto | null> {
  const db = asExecutor(exec)
  const rows = await db.select(selection).from(siteLinks).where(eq(siteLinks.id, BigInt(id))).limit(1)
  const r = rows[0]
  return r
    ? toLinkDto(r.row, { categoryName: r.categoryName, tagName: r.tagName, clickCount: r.clickCount, hasDetail: r.hasDetail })
    : null
}

export async function getLinkDetail(exec: Executor, linkId: string): Promise<LinkDetailDto | null> {
  const db = asExecutor(exec)
  const rows = await db.select().from(siteLinkDetails).where(eq(siteLinkDetails.linkId, BigInt(linkId))).limit(1)
  const r = rows[0]
  return r ? toDetailDto(r) : null
}

export async function listMirrors(exec: Executor, linkId: string): Promise<LinkMirrorDto[]> {
  const db = asExecutor(exec)
  const rows = await db
    .select()
    .from(siteLinkMirrors)
    .where(eq(siteLinkMirrors.linkId, BigInt(linkId)))
    .orderBy(asc(siteLinkMirrors.sortOrder), asc(siteLinkMirrors.id))
  return rows.map(toMirrorDto)
}

export type LinkBrief = {
  id: string
  categoryId: string
  tagId: string | null
  title: string
  url: string
  description: string
  logoPath: string
  isGone: boolean
  status: "draft" | "published" | "disabled"
  sortOrder: number
  version: number
  deletedAt: string | null
}

/**
 * 写路径行锁（SELECT ... FOR UPDATE）。
 * 锁序约定：网址事务一律「先锁 site_links 自身行，再读分类/标签父行」
 * （分类 Service 只锁分类行不锁网址行，两套锁序无环，不会死锁）。
 * 关闭「读取 version/状态 → 更新」之间的 TOCTOU；仅在事务内调用。
 */
export async function lockLinkForUpdate(exec: Executor, id: string): Promise<LinkBrief | null> {
  const db = asExecutor(exec)
  const rows = await db
    .select({
      id: siteLinks.id,
      categoryId: siteLinks.categoryId,
      tagId: siteLinks.tagId,
      title: siteLinks.title,
      url: siteLinks.url,
      description: siteLinks.description,
      logoPath: siteLinks.logoPath,
      isGone: siteLinks.isGone,
      status: siteLinks.status,
      sortOrder: siteLinks.sortOrder,
      version: siteLinks.version,
      deletedAt: siteLinks.deletedAt,
    })
    .from(siteLinks)
    .where(eq(siteLinks.id, BigInt(id)))
    .limit(1)
    .for("update")
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id.toString(),
    categoryId: r.categoryId.toString(),
    tagId: idToString(r.tagId),
    title: r.title,
    url: r.url,
    description: r.description,
    logoPath: r.logoPath,
    isGone: r.isGone,
    status: r.status,
    sortOrder: r.sortOrder,
    version: r.version,
    deletedAt: r.deletedAt ?? null,
  }
}

/** 一批备用链接 ID 的归属检查（id → linkId；聚合 PATCH 防跨网址改行） */
export async function getMirrorOwners(exec: Executor, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const db = asExecutor(exec)
  const rows = await db
    .select({ id: siteLinkMirrors.id, linkId: siteLinkMirrors.linkId })
    .from(siteLinkMirrors)
    .where(inArray(siteLinkMirrors.id, ids.map(BigInt)))
  return new Map(rows.map((r) => [r.id.toString(), r.linkId.toString()]))
}

/** 全局当前最大 sortOrder（新建默认追加到末尾；与分类的“作用域”不同，网址排序是全局列表序） */
export async function maxSortOrderAll(exec: Executor): Promise<number> {
  const db = asExecutor(exec)
  const rows = await db
    .select({ m: sql<unknown>`coalesce(max(${siteLinks.sortOrder}), 0)` })
    .from(siteLinks)
    .where(isNull(siteLinks.deletedAt))
  return Number((rows[0] as { m: unknown } | undefined)?.m ?? 0)
}

// ── 写（仅事务内调用）───────────────────────────────────────────

export interface NewLinkValues {
  title: string
  url: string
  description: string
  logoPath: string
  categoryId: string
  tagId: string | null
  sortOrder: number
}

/** 新建（恒 draft、source_snapshot=false）；返回数据库生成的精确十进制 ID */
export async function insertLink(tx: AdminTx, v: NewLinkValues): Promise<string> {
  await asExecutor(tx)
    .insert(siteLinks)
    .values({
      title: v.title,
      url: v.url,
      description: v.description,
      logoPath: v.logoPath,
      categoryId: BigInt(v.categoryId),
      tagId: v.tagId === null ? null : BigInt(v.tagId),
      sortOrder: v.sortOrder,
      status: "draft",
      sourceSnapshot: false,
      isGone: false,
    })
  return lastInsertIdString(tx)
}

export interface LinkPatch {
  title?: string
  url?: string
  description?: string
  logoPath?: string
  categoryId?: string
  /** null = 清除标签关联 */
  tagId?: string | null
  sortOrder?: number
  /** 状态切换专用（普通 PATCH 由 Service 控制字段，不带 status） */
  status?: "draft" | "published" | "disabled"
}

/** 乐观锁更新：WHERE id AND version AND deleted_at IS NULL；空 patch = 仅 bump 版本 */
export async function updateLinkWithVersion(tx: AdminTx, id: string, expectedVersion: number, patch: LinkPatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    version: sql`${siteLinks.version} + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.url !== undefined) set.url = patch.url
  if (patch.description !== undefined) set.description = patch.description
  if (patch.logoPath !== undefined) set.logoPath = patch.logoPath
  if (patch.categoryId !== undefined) set.categoryId = BigInt(patch.categoryId)
  if (patch.tagId !== undefined) set.tagId = patch.tagId === null ? null : BigInt(patch.tagId)
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
  if (patch.status !== undefined) set.status = patch.status
  const res = (await asExecutor(tx)
    .update(siteLinks)
    .set(set)
    .where(
      and(eq(siteLinks.id, BigInt(id)), eq(siteLinks.version, expectedVersion), isNull(siteLinks.deletedAt)),
    )) as unknown as [{ affectedRows?: number }, unknown]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 状态切换（乐观锁；状态机规则在 Service） */
export async function setLinkStatusWithVersion(
  tx: AdminTx,
  id: string,
  expectedVersion: number,
  status: "draft" | "published" | "disabled",
): Promise<boolean> {
  return updateLinkWithVersion(tx, id, expectedVersion, { status })
}

export async function softDeleteLink(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLinks)
    .set({
      deletedAt: sql`CURRENT_TIMESTAMP(3)`,
      version: sql`${siteLinks.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(siteLinks.id, BigInt(id)), eq(siteLinks.version, expectedVersion), isNull(siteLinks.deletedAt)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export async function restoreLink(tx: AdminTx, id: string, expectedVersion: number): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLinks)
    .set({
      deletedAt: null,
      version: sql`${siteLinks.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP(3)`,
    })
    .where(and(eq(siteLinks.id, BigInt(id)), eq(siteLinks.version, expectedVersion), sql`${siteLinks.deletedAt} is not null`))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

export interface DetailUpsertValues {
  annotation?: string
  previewImage?: string
  detailHtml?: string
  clickCount?: number
  likeCount?: number
}

/**
 * 详情 1:1 upsert（INSERT ... ON DUPLICATE KEY UPDATE；主键 link_id）。
 * 只更新提供的字段（部分编辑不覆盖其他字段）。
 */
export async function upsertDetail(tx: AdminTx, linkId: string, v: DetailUpsertValues): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP(3)` }
  if (v.annotation !== undefined) set.annotation = v.annotation
  if (v.previewImage !== undefined) set.previewImage = v.previewImage
  if (v.detailHtml !== undefined) set.detailHtml = v.detailHtml
  if (v.clickCount !== undefined) set.clickCount = BigInt(v.clickCount)
  if (v.likeCount !== undefined) set.likeCount = BigInt(v.likeCount)
  await asExecutor(tx)
    .insert(siteLinkDetails)
    .values({
      linkId: BigInt(linkId),
      annotation: v.annotation ?? "",
      previewImage: v.previewImage ?? "",
      detailHtml: v.detailHtml ?? "",
      clickCount: BigInt(v.clickCount ?? 0),
      likeCount: BigInt(v.likeCount ?? 0),
    })
    .onDuplicateKeyUpdate({ set: set as typeof siteLinkDetails.$inferInsert })
}

/** 删除详情行（PATCH detail:null；物理删除的是补充数据，主行仍软删除） */
export async function deleteDetail(tx: AdminTx, linkId: string): Promise<boolean> {
  const res = (await asExecutor(tx).delete(siteLinkDetails).where(eq(siteLinkDetails.linkId, BigInt(linkId)))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) >= 1
}

/** 新建备用链接（sortOrder 由 Service 按数组序分配） */
export async function insertMirror(tx: AdminTx, linkId: string, v: { name: string; url: string; sortOrder: number }): Promise<void> {
  await asExecutor(tx)
    .insert(siteLinkMirrors)
    .values({ linkId: BigInt(linkId), name: v.name, url: v.url, sortOrder: v.sortOrder })
}

/** 更新备用链接（WHERE id AND link_id 双条件：归属防呆） */
export async function updateMirror(
  tx: AdminTx,
  mirrorId: string,
  linkId: string,
  v: { name: string; url: string; sortOrder: number },
): Promise<boolean> {
  const res = (await asExecutor(tx)
    .update(siteLinkMirrors)
    .set({ name: v.name, url: v.url, sortOrder: v.sortOrder, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(siteLinkMirrors.id, BigInt(mirrorId)), eq(siteLinkMirrors.linkId, BigInt(linkId))))) as unknown as [
    { affectedRows?: number },
    unknown,
  ]
  return Number(res[0]?.affectedRows ?? 0) === 1
}

/** 批量删除备用链接（全量替换语义中被移除的旧行；同样带 link_id 条件） */
export async function deleteMirrorsByIds(tx: AdminTx, linkId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await asExecutor(tx)
    .delete(siteLinkMirrors)
    .where(and(eq(siteLinkMirrors.linkId, BigInt(linkId)), inArray(siteLinkMirrors.id, ids.map(BigInt))))
}
