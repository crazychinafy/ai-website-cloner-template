-- P6A.1：三张内容表加「活动名称」STORED 生成列 + UNIQUE 索引（软删除唯一名称的数据库层并发防线）。
-- link_categories：uq (parent_scope_id, active_name)，根分类 parent_scope_id 哨兵 0（合法 ID ≥1，永不冲突）；
-- article_categories / site_tags：uq (active_name) 全局。软删除行 active_name=NULL，NULL 互不相等 → 历史同名行共存。
-- 迁移前置检查：已有「未删除同名」冲突数据时用 SIGNAL 明确报错中止（绝不自动删除/重命名已有数据）；
-- 无冲突时检查为空操作。冲突清单（≤128 字符）出现在 MySQL 错误消息里，便于人工处理后再重跑。
DROP PROCEDURE IF EXISTS `p6a1_assert_active_name_unique`;--> statement-breakpoint
CREATE PROCEDURE `p6a1_assert_active_name_unique`()
BEGIN
  DECLARE msg TEXT;
  SELECT SUBSTRING(GROUP_CONCAT(x.item ORDER BY x.item SEPARATOR '; '), 1, 128) INTO msg FROM (
    SELECT CONCAT('link_categories[', IFNULL(CAST(parent_id AS CHAR), 'ROOT'), '/', name, '] x', CAST(COUNT(*) AS CHAR)) AS item
    FROM link_categories WHERE deleted_at IS NULL GROUP BY parent_id, name HAVING COUNT(*) > 1
  ) x;
  IF msg IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;
  SET msg = NULL;
  SELECT SUBSTRING(GROUP_CONCAT(x.item ORDER BY x.item SEPARATOR '; '), 1, 128) INTO msg FROM (
    SELECT CONCAT('article_categories[', name, '] x', CAST(COUNT(*) AS CHAR)) AS item
    FROM article_categories WHERE deleted_at IS NULL GROUP BY name HAVING COUNT(*) > 1
  ) x;
  IF msg IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;
  SET msg = NULL;
  SELECT SUBSTRING(GROUP_CONCAT(x.item ORDER BY x.item SEPARATOR '; '), 1, 128) INTO msg FROM (
    SELECT CONCAT('site_tags[', name, '] x', CAST(COUNT(*) AS CHAR)) AS item
    FROM site_tags WHERE deleted_at IS NULL GROUP BY name HAVING COUNT(*) > 1
  ) x;
  IF msg IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;
END;--> statement-breakpoint
CALL `p6a1_assert_active_name_unique`();--> statement-breakpoint
DROP PROCEDURE IF EXISTS `p6a1_assert_active_name_unique`;--> statement-breakpoint
ALTER TABLE `article_categories` ADD `active_name` varchar(120) GENERATED ALWAYS AS ((case when `deleted_at` is null then `name` else null end)) STORED;--> statement-breakpoint
ALTER TABLE `link_categories` ADD `parent_scope_id` bigint unsigned GENERATED ALWAYS AS ((case when `parent_id` is null then 0 else `parent_id` end)) STORED;--> statement-breakpoint
ALTER TABLE `link_categories` ADD `active_name` varchar(120) GENERATED ALWAYS AS ((case when `deleted_at` is null then `name` else null end)) STORED;--> statement-breakpoint
ALTER TABLE `site_tags` ADD `active_name` varchar(100) GENERATED ALWAYS AS ((case when `deleted_at` is null then `name` else null end)) STORED;--> statement-breakpoint
ALTER TABLE `article_categories` ADD CONSTRAINT `uq_article_categories_active_name` UNIQUE(`active_name`);--> statement-breakpoint
ALTER TABLE `link_categories` ADD CONSTRAINT `uq_link_categories_active_name` UNIQUE(`parent_scope_id`,`active_name`);--> statement-breakpoint
ALTER TABLE `site_tags` ADD CONSTRAINT `uq_site_tags_active_name` UNIQUE(`active_name`);
