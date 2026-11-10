-- 0000 初始迁移：彩搜搜管理后台 23 张表（由 drizzle-kit 0.31.11 从 src/lib/db/schema 生成）
-- 手工补丁（scripts/admin/patch-migration.mjs 施加，可重复执行）：
--   1) 13 个 updated_at 列补 "ON UPDATE CURRENT_TIMESTAMP(3)"（kit 无法生成带 fsp 的 ON UPDATE）
--   2) 23 个 CREATE TABLE 补 "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"（不依赖服务器默认值）
-- 本迁移不含任何 DROP / TRUNCATE / 数据覆盖语句；外键统一后置 ALTER 添加，保证建表顺序安全。
CREATE TABLE `admin_users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`email` varchar(190),
	`password_hash` varchar(255) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`status` enum('active','disabled','locked') NOT NULL DEFAULT 'active',
	`must_change_password` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime(3),
	`password_changed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_users_username` UNIQUE(`username`),
	CONSTRAINT `uq_admin_users_email` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_permissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(100) NOT NULL,
	`name` varchar(120) NOT NULL,
	`resource` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	CONSTRAINT `admin_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_permissions_code` UNIQUE(`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_role_permissions` (
	`role_id` bigint unsigned NOT NULL,
	`permission_id` bigint unsigned NOT NULL,
	CONSTRAINT `pk_admin_role_permissions` PRIMARY KEY(`role_id`,`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(255),
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_roles_code` UNIQUE(`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_user_roles` (
	`user_id` bigint unsigned NOT NULL,
	`role_id` bigint unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pk_admin_user_roles` PRIMARY KEY(`user_id`,`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_login_attempts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username_key` char(64) NOT NULL,
	`ip_key` char(64) NOT NULL,
	`attempted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`succeeded` boolean NOT NULL DEFAULT false,
	CONSTRAINT `admin_login_attempts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revoked_at` datetime(3),
	`user_agent` varchar(500),
	`ip_address` varbinary(16),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_admin_sessions_token_hash` UNIQUE(`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `article_categories` (
	`id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`icon_class` varchar(255) NOT NULL DEFAULT '',
	`sort_order` int NOT NULL DEFAULT 0,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `article_categories_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `link_categories` (
	`id` bigint unsigned NOT NULL,
	`parent_id` bigint unsigned,
	`name` varchar(120) NOT NULL,
	`icon_class` varchar(255) NOT NULL DEFAULT '',
	`sort_order` int NOT NULL DEFAULT 0,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`source_snapshot` boolean NOT NULL DEFAULT true,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `link_categories_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_link_details` (
	`link_id` bigint unsigned NOT NULL,
	`click_count` bigint unsigned NOT NULL DEFAULT 0,
	`like_count` bigint unsigned NOT NULL DEFAULT 0,
	`annotation` varchar(500) NOT NULL DEFAULT '',
	`preview_image` varchar(1024) NOT NULL DEFAULT '',
	`detail_html` longtext NOT NULL,
	`source_created_at` datetime(3),
	`source_updated_at` datetime(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_link_details_link_id` PRIMARY KEY(`link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_link_mirrors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`link_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_link_mirrors_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_links` (
	`id` bigint unsigned NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`tag_id` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`description` text NOT NULL,
	`logo_path` varchar(1024) NOT NULL DEFAULT '',
	`is_gone` boolean NOT NULL DEFAULT false,
	`status` enum('draft','published','disabled') NOT NULL DEFAULT 'published',
	`sort_order` int NOT NULL DEFAULT 0,
	`source_snapshot` boolean NOT NULL DEFAULT true,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `site_links_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `articles` (
	`id` bigint unsigned NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`title` varchar(500) NOT NULL,
	`content_html` longtext NOT NULL,
	`cover_image` varchar(1024) NOT NULL DEFAULT '',
	`category_name_snapshot` varchar(120) NOT NULL DEFAULT '',
	`seo_title` varchar(500) NOT NULL DEFAULT '',
	`seo_keywords` varchar(1000) NOT NULL DEFAULT '',
	`seo_description` varchar(1000) NOT NULL DEFAULT '',
	`view_count` bigint unsigned NOT NULL DEFAULT 0,
	`author_name` varchar(120) NOT NULL DEFAULT '',
	`author_avatar` varchar(1024) NOT NULL DEFAULT '',
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'published',
	`published_at` datetime(3),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `articles_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `bulletins` (
	`id` bigint unsigned NOT NULL,
	`title` varchar(500) NOT NULL,
	`content_html` longtext NOT NULL,
	`status` enum('draft','published','archived') NOT NULL DEFAULT 'published',
	`sort_order` int NOT NULL DEFAULT 0,
	`published_at` datetime(3),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `bulletins_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `ads` (
	`id` bigint unsigned NOT NULL,
	`position` varchar(64) NOT NULL DEFAULT 'home',
	`title` varchar(255) NOT NULL,
	`target_url` varchar(2048) NOT NULL,
	`image_path` varchar(1024) NOT NULL,
	`status` enum('draft','active','disabled','expired') NOT NULL DEFAULT 'active',
	`sort_order` int NOT NULL DEFAULT 0,
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `ads_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_tags` (
	`id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`icon_class` varchar(255) NOT NULL DEFAULT '',
	`color` varchar(32) NOT NULL DEFAULT '#000000',
	`bg_color` varchar(32) NOT NULL DEFAULT '#ffffff',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`sort_order` int NOT NULL DEFAULT 0,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `site_tags_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_lines` (
	`id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`sort_order` int NOT NULL DEFAULT 0,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `site_lines_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `icon_libraries` (
	`id` bigint unsigned NOT NULL,
	`prefix` varchar(64) NOT NULL DEFAULT 'icon-',
	`hash` varchar(64) NOT NULL,
	`css_path` varchar(1024) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `icon_libraries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_icon_libraries_hash` UNIQUE(`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_pages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`page_key` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`subtitle` varchar(500) NOT NULL DEFAULT '',
	`content_html` longtext NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`updated_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_site_pages_key` UNIQUE(`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`setting_key` varchar(100) NOT NULL,
	`setting_value` json NOT NULL,
	`updated_by` bigint unsigned,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `site_settings_setting_key` PRIMARY KEY(`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`sha256` char(64) NOT NULL,
	`width` int unsigned,
	`height` int unsigned,
	`uploaded_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `media_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_media_storage_key` UNIQUE(`storage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_user_id` bigint unsigned,
	`action` varchar(100) NOT NULL,
	`resource_type` varchar(100) NOT NULL,
	`resource_id` varchar(100),
	`before_json` json,
	`after_json` json,
	`request_id` varchar(64),
	`ip_address` varbinary(16),
	`user_agent` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_audit_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
CREATE TABLE `admin_import_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`snapshot_version` varchar(100) NOT NULL,
	`mode` enum('dry_run','import') NOT NULL,
	`status` enum('pending','running','succeeded','failed','cancelled') NOT NULL,
	`summary_json` json,
	`checksum` char(64),
	`started_by` bigint unsigned,
	`started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	`error_summary` text,
	CONSTRAINT `admin_import_runs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
--> statement-breakpoint
ALTER TABLE `admin_role_permissions` ADD CONSTRAINT `admin_role_permissions_role_id_admin_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_role_permissions` ADD CONSTRAINT `admin_role_permissions_permission_id_admin_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `admin_permissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_role_id_admin_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `link_categories` ADD CONSTRAINT `fk_link_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `link_categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_link_details` ADD CONSTRAINT `site_link_details_link_id_site_links_id_fk` FOREIGN KEY (`link_id`) REFERENCES `site_links`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_link_mirrors` ADD CONSTRAINT `site_link_mirrors_link_id_site_links_id_fk` FOREIGN KEY (`link_id`) REFERENCES `site_links`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_links` ADD CONSTRAINT `site_links_category_id_link_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `link_categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_links` ADD CONSTRAINT `site_links_tag_id_site_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `site_tags`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `articles` ADD CONSTRAINT `articles_category_id_article_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `article_categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_pages` ADD CONSTRAINT `site_pages_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_settings` ADD CONSTRAINT `site_settings_updated_by_admin_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_uploaded_by_admin_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_actor_user_id_admin_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_import_runs` ADD CONSTRAINT `admin_import_runs_started_by_admin_users_id_fk` FOREIGN KEY (`started_by`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_users_status` ON `admin_users` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_permissions_resource` ON `admin_permissions` (`resource`,`action`);--> statement-breakpoint
CREATE INDEX `idx_admin_login_username_time` ON `admin_login_attempts` (`username_key`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_login_ip_time` ON `admin_login_attempts` (`ip_key`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_sessions_user_expiry` ON `admin_sessions` (`user_id`,`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_article_categories_status_sort` ON `article_categories` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_link_categories_parent_sort` ON `link_categories` (`parent_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_site_link_mirrors_link_sort` ON `site_link_mirrors` (`link_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_site_links_category_status_sort` ON `site_links` (`category_id`,`status`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_site_links_tag_status` ON `site_links` (`tag_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_site_links_updated` ON `site_links` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_articles_category_status_date` ON `articles` (`category_id`,`status`,`deleted_at`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_articles_status_created` ON `articles` (`status`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bulletins_status_sort` ON `bulletins` (`status`,`deleted_at`,`sort_order`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_ads_position_status_sort` ON `ads` (`position`,`status`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_ads_schedule` ON `ads` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_site_tags_status_sort` ON `site_tags` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_site_lines_status_sort` ON `site_lines` (`status`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_media_sha256` ON `media_assets` (`sha256`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_actor_time` ON `admin_audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_resource` ON `admin_audit_logs` (`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_import_runs_status_time` ON `admin_import_runs` (`status`,`started_at`);