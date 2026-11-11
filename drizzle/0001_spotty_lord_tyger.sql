-- P6A：三张内容表 id 切换为 BIGINT UNSIGNED AUTO_INCREMENT（P6A 起新记录由数据库生成 ID）。
-- MySQL 8 禁止在有子表外键引用时 MODIFY 父表主键（errno 1833）；drizzle 迁移器按顺序在
-- 同一连接上执行全部语句，故用会话级外键开关包裹 DDL（DDL 隐式提交，开关在末尾复位）。
SET FOREIGN_KEY_CHECKS = 0;--> statement-breakpoint
ALTER TABLE `article_categories` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `link_categories` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `site_tags` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;
