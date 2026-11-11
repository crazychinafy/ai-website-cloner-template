-- P6C：articles.id / bulletins.id 切换为 BIGINT UNSIGNED AUTO_INCREMENT（P6C 起文章/公告新建由数据库生成 ID）。
-- 与 0001/0003 同构：既有 17/18 位原始雪花 ID 原样保留（不重建、不清空）；AUTO_INCREMENT 下一值由 MySQL 取 max(id)+1，
-- 与历史雪花 ID 不冲突。两表均无入向外键引用（information_schema 核实），MODIFY 不会触发 errno 1833；
-- 仍按 0003 模式包裹 FK 检查作为防御（DDL 隐式提交，末尾必须恢复开关）。
SET FOREIGN_KEY_CHECKS = 0;--> statement-breakpoint
ALTER TABLE `articles` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `bulletins` MODIFY COLUMN `id` bigint unsigned AUTO_INCREMENT NOT NULL;--> statement-breakpoint
SET FOREIGN_KEY_CHECKS = 1;
