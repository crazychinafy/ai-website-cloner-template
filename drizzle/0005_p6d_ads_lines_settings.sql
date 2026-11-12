-- P6D：ads.id / site_lines.id 切换为 BIGINT UNSIGNED AUTO_INCREMENT（P6D 起广告/线路新建由数据库生成 ID），
-- site_settings 增加 version 列（逐 key 乐观锁，DTO 合同 version 由列映射）。
-- 与 0004 同构：既有 17/18 位原始雪花 ID 原样保留（不重建、不清空）；AUTO_INCREMENT 下一值由 MySQL 取 max(id)+1，
-- 与历史雪花 ID 不冲突。两表均无入向外键引用（information_schema 核实），MODIFY 不会触发 errno 1833；
-- 仍按 0003/0004 模式包裹 FK 检查作为防御（DDL 隐式提交，末尾必须恢复开关）。
ALTER TABLE `site_settings` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 0;--> statement-breakpoint
ALTER TABLE `ads` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `site_lines` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;
