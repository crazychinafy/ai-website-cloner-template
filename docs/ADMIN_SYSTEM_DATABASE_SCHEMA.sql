-- 彩搜搜后台管理数据库结构
-- MySQL 8.0.36+ / 8.4 LTS，InnoDB，utf8mb4
-- 说明：此文件为目标 schema。实施时由 Drizzle migration 生成并纳入版本控制；
-- 不要在生产环境直接手工执行本文件替代 migration。
-- 原始静态快照 ID 是十进制字符串；数据库 BIGINT UNSIGNED，Node.js 端必须按 string 处理。

CREATE DATABASE IF NOT EXISTS facai8_admin
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE facai8_admin;

CREATE TABLE admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  email VARCHAR(190) NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME(3) NULL,
  password_changed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_admin_users_username (username),
  UNIQUE KEY uq_admin_users_email (email),
  KEY idx_admin_users_status (status, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE admin_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_admin_roles_code (code)
) ENGINE=InnoDB;

CREATE TABLE admin_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  resource VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_admin_permissions_code (code),
  KEY idx_admin_permissions_resource (resource, action)
) ENGINE=InnoDB;

CREATE TABLE admin_user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_admin_user_roles_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_user_roles_role FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE admin_role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_admin_role_permissions_role FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES admin_permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  user_agent VARCHAR(500) NULL,
  ip_address VARBINARY(16) NULL,
  UNIQUE KEY uq_admin_sessions_token_hash (token_hash),
  KEY idx_admin_sessions_user_expiry (user_id, expires_at, revoked_at),
  CONSTRAINT fk_admin_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE admin_login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username_key CHAR(64) NOT NULL,
  ip_key CHAR(64) NOT NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  KEY idx_admin_login_username_time (username_key, attempted_at),
  KEY idx_admin_login_ip_time (ip_key, attempted_at)
) ENGINE=InnoDB;

CREATE TABLE link_categories (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  icon_class VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  source_snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_link_categories_parent_sort (parent_id, status, sort_order),
  CONSTRAINT fk_link_categories_parent FOREIGN KEY (parent_id) REFERENCES link_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE article_categories (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  icon_class VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_article_categories_status_sort (status, sort_order)
) ENGINE=InnoDB;

CREATE TABLE site_tags (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon_class VARCHAR(255) NOT NULL DEFAULT '',
  color VARCHAR(32) NOT NULL DEFAULT '#000000',
  bg_color VARCHAR(32) NOT NULL DEFAULT '#ffffff',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_site_tags_status_sort (status, sort_order)
) ENGINE=InnoDB;

CREATE TABLE site_links (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  category_id BIGINT UNSIGNED NOT NULL,
  tag_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  description TEXT NOT NULL,
  logo_path VARCHAR(1024) NOT NULL DEFAULT '',
  is_gone BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('draft','published','disabled') NOT NULL DEFAULT 'published',
  sort_order INT NOT NULL DEFAULT 0,
  source_snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_site_links_category_status_sort (category_id, status, deleted_at, sort_order),
  KEY idx_site_links_tag_status (tag_id, status, deleted_at),
  KEY idx_site_links_updated (updated_at),
  CONSTRAINT fk_site_links_category FOREIGN KEY (category_id) REFERENCES link_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_site_links_tag FOREIGN KEY (tag_id) REFERENCES site_tags(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE site_link_details (
  link_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  click_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  annotation VARCHAR(500) NOT NULL DEFAULT '',
  preview_image VARCHAR(1024) NOT NULL DEFAULT '',
  detail_html LONGTEXT NOT NULL,
  source_created_at DATETIME(3) NULL,
  source_updated_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_site_link_details_link FOREIGN KEY (link_id) REFERENCES site_links(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE site_link_mirrors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  link_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_site_link_mirrors_link_sort (link_id, sort_order),
  CONSTRAINT fk_site_link_mirrors_link FOREIGN KEY (link_id) REFERENCES site_links(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE articles (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  category_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  content_html LONGTEXT NOT NULL,
  cover_image VARCHAR(1024) NOT NULL DEFAULT '',
  category_name_snapshot VARCHAR(120) NOT NULL DEFAULT '',
  seo_title VARCHAR(500) NOT NULL DEFAULT '',
  seo_keywords VARCHAR(1000) NOT NULL DEFAULT '',
  seo_description VARCHAR(1000) NOT NULL DEFAULT '',
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  author_name VARCHAR(120) NOT NULL DEFAULT '',
  author_avatar VARCHAR(1024) NOT NULL DEFAULT '',
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'published',
  published_at DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_articles_category_status_date (category_id, status, deleted_at, published_at),
  KEY idx_articles_status_created (status, deleted_at, created_at),
  CONSTRAINT fk_articles_category FOREIGN KEY (category_id) REFERENCES article_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE bulletins (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content_html LONGTEXT NOT NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'published',
  sort_order INT NOT NULL DEFAULT 0,
  published_at DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_bulletins_status_sort (status, deleted_at, sort_order, published_at)
) ENGINE=InnoDB;

CREATE TABLE ads (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  position VARCHAR(64) NOT NULL DEFAULT 'home',
  title VARCHAR(255) NOT NULL,
  target_url VARCHAR(2048) NOT NULL,
  image_path VARCHAR(1024) NOT NULL,
  status ENUM('draft','active','disabled','expired') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_ads_position_status_sort (position, status, deleted_at, sort_order),
  KEY idx_ads_schedule (starts_at, ends_at)
) ENGINE=InnoDB;

CREATE TABLE site_lines (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_site_lines_status_sort (status, deleted_at, sort_order)
) ENGINE=InnoDB;

CREATE TABLE icon_libraries (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  prefix VARCHAR(64) NOT NULL DEFAULT 'icon-',
  hash VARCHAR(64) NOT NULL,
  css_path VARCHAR(1024) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_icon_libraries_hash (hash)
) ENGINE=InnoDB;

CREATE TABLE site_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  page_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(500) NOT NULL DEFAULT '',
  content_html LONGTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_site_pages_key (page_key),
  CONSTRAINT fk_site_pages_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE site_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_site_settings_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE media_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  storage_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_media_storage_key (storage_key),
  KEY idx_media_sha256 (sha256),
  CONSTRAINT fk_media_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(100) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_id VARCHAR(64) NULL,
  ip_address VARBINARY(16) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_admin_audit_actor_time (actor_user_id, created_at),
  KEY idx_admin_audit_resource (resource_type, resource_id, created_at),
  CONSTRAINT fk_admin_audit_actor FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE admin_import_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  snapshot_version VARCHAR(100) NOT NULL,
  mode ENUM('dry_run','import') NOT NULL,
  status ENUM('pending','running','succeeded','failed','cancelled') NOT NULL,
  summary_json JSON NULL,
  checksum CHAR(64) NULL,
  started_by BIGINT UNSIGNED NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  error_summary TEXT NULL,
  KEY idx_admin_import_runs_status_time (status, started_at),
  CONSTRAINT fk_admin_import_runs_actor FOREIGN KEY (started_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 初始角色/权限由受版本控制的 seed 脚本写入，不在这里插入默认管理员密码。
