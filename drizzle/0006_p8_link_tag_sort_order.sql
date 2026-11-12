-- P8-0：site_links 新增 tag_sort_order（标签页网格规范序：所属标签组内稠密排名 0..n-1，
-- = TAG_ORDER 序列优先、其余按档案序追加；与分类页 sort_order 同构，导入/回填/后台写入）。
-- 向后兼容：可空列 + 新增索引，既有数据与查询不受影响；历史行由 scripts/admin/backfill-tag-sort-order.ts 回填。
ALTER TABLE `site_links` ADD `tag_sort_order` int;--> statement-breakpoint
CREATE INDEX `idx_site_links_tag_sort` ON `site_links` (`tag_id`,`status`,`deleted_at`,`tag_sort_order`,`id`);