-- P6B：网址主表 id 切换为 BIGINT UNSIGNED AUTO_INCREMENT（P6B 起新网址由数据库生成 ID）。
-- 与 0001 同理：site_links.id 被子表（site_link_details / site_link_mirrors）外键引用，
-- MySQL 8 禁止在有子表外键引用时 MODIFY 父表主键（errno 1833）；drizzle 迁移器按顺序在
-- 同一连接上执行全部语句，故用会话级外键开关包裹 DDL（DDL 隐式提交，开关在末尾复位）。
-- 不做数据重建/清空：静态快照的 17/18 位原始 ID 原样保留，AUTO_INCREMENT 起点由 MySQL
-- 取 max(id)+1（大于全部雪花 ID），新行永不与快照 ID 冲突。
SET FOREIGN_KEY_CHECKS = 0;--> statement-breakpoint
ALTER TABLE `site_links` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;
