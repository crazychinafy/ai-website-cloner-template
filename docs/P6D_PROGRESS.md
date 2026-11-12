# P6D 进度存档（任务暂停点）

> 记录时间：2026-11-12。用途：暂停后恢复执行 P6D 时的完整交接状态。
> 任务合同：`docs/p6d.md`（广告管理 /admin/ads、线路管理 /admin/lines、站点设置 /admin/settings）。

## 当前分支与提交

- 当前分支：`feat/p6d-ads-lines-settings`（已从 P6C HEAD 创建，尚未有任何 P6D 提交）。
- `5d66984` — P6C 完整提交（articles+bulletins 管理模块 + 三项验收整改：DTO 读取层消毒、分类锁序、统一 media-path 校验），P6C 至此已验收、已入库。
- P6D 实施**尚未开始**：未写迁移、未写代码、未建测试。

## 已完成的 P6D 前置调研（本次暂停前）

### RBAC（无需改 seed-rbac.ts）
`scripts/admin/seed-rbac.ts` 已存在全部所需权限码：`ads.view/create/update/delete`、
`lines.view/create/update/delete`、`settings.view/update`，角色映射也已配好：
- super_admin：全部
- content_admin：ads.* + lines.*（**无 settings**）
- content_editor：ads.view/create/update + lines.view/create/update（**无 delete**）
- auditor：仅 *.view（只读）

→ p6d.md §8 要求的角色矩阵可直接复用现有种子，测试里用 4 角色断言即可。

### 前端冻结基线（P6D 不得触碰）
- 静态源数据：`src/lib/facai8/data/`（ads.ts / lines.ts / site-info.ts 等 20 文件）——SHA 冻结对象。
- 首页广告是**硬编码** `src/components/sites/facai8/home/constants.ts` 里的 `HOME_ADS`（图片
  `/sites/facai8/images/{square,rectangle,advertise}/*.jpg`），**不是**读 `data/ads.ts`。
- 线路页 `src/components/sites/facai8/Lines.tsx` 读 `data/lines.ts`，并在**浏览器端**探测 URL 可达性；
  服务端保存线路时**不得**探测（p6d §6.5）。
- 线路真实数据：50 条，全部 status='active'、sync_state='synced'；**全部 mirror=0、tags=0**；
  categories 仅 4 个：华东=1、华南=2、华北=3、东北=4。历史线路 id 1..50。
- 历史广告 id：1..9（home 位，starts=2026-01-01 ends=2027-12-31，active，sort 1..9）；
  广告图片物理存在于 `public/sites/facai8/images/{square(3),rectangle(3),advertise(3)}`。

### 现行 DB 表结构（facai8_admin，DESCRIBE 实测）
- `ads`：id BIGINT **无 AUTO_INCREMENT**（需 0005 迁移加）、image_path varchar(1024) NOT NULL、
  target_url NOT NULL、link_target enum(_blank,_self) 默认 _blank、starts_at/ends_at datetime(3) NOT NULL、
  status enum(draft,active,disabled,expired)、sort/version INT UNSIGNED 默认 0/1、created_by/updated_by、
  deleted_at、KEY idx_position_home/is_home_status_sort。FK → users(id)（迁移须 FK_CHECKS 包裹）。
- `site_lines`：id BIGINT 无 AUTO_INCREMENT（需迁移）、name/url NOT NULL、description 可空、
  categories/mirrors/tags JSON、status enum(active,disabled)、同套 audit 列。
- `site_settings`：setting_key PK varchar(64)、setting_value TEXT NOT NULL、description、
  created_by/updated_by/at —— **缺 version 列**（需迁移加 `version INT UNSIGNED NOT NULL DEFAULT 1`）。
  注意该表 PK 是字符串，不是 BIGINT，version 迁移无 AUTO_INCREMENT 问题。

### 可复用模式
- 线路迁移照 P6B links 模式（`drizzle/0003_p6b_links_auto_increment.sql` 的写法与 AUTO_INCREMENT 重置）。
- Drizzle schema：`src/lib/db/schema/ad.ts`、`line.ts` 用 bigint mode number + 需加 autoincrement；
  `settings.ts` 加 version 列。改后同步 `docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql`。
- P6C 统一媒体校验 `src/lib/admin/validation/media-path.ts`（parseMediaPathValue，站点前缀白名单，
  外部 URL 由 `ALLOW_EXTERNAL_MEDIA=true` 显式策略放行）——P6D 的"文件存在性校验"应在此文件
  **扩展** server-only resolver，不在 ad-service/setting-service 重复实现。
- URL 校验复用 `src/lib/admin/validation/link-schema.ts`（checkHttpUrl / httpUrlSchema，仅 http/https）。
- 测试骨架复用 `test/admin/p6c-harness.ts` 模式（scratch 库全量重放迁移、4 测试角色、CSRF/audit 断言 helper）；
  新测试命名 `test/admin/p6d-ads-api.test.ts`、`p6d-lines-api.test.ts`、`p6d-settings-api.test.ts`、
  `p6d-media-path.test.ts`（harness 可提取共享或按 P6C 模式新建 p6d-harness）。
- 迁移重放器读 `drizzle/_journal.json`（test-db.ts），新迁移必须登记 journal 否则不生效。
- UI 复用 `src/components/admin/ui/`（DataTable/Pagination/StatusBadge/ConfirmDialog/Toast/
  AdminPageHeader/EmptyState）+ 表单模式参照 LinkTable.tsx/CategoryTreeView.tsx。

## 恢复执行清单（按 p6d.md 顺序）

1. **迁移 0005**（登记 journal）：ads.id、site_lines.id 加 AUTO_INCREMENT（保留历史 id，重置 next-id>max，
   FK_CHECKS 包裹）；site_settings 加 version INT UNSIGNED NOT NULL DEFAULT 1；同步 drizzle schema 与
   docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql；scratch 全量重放验证（历史 id 不变、插入自增、重放幂等）。
2. **后端 ads**：dto/validation → repository（string id）→ service（position 白名单=home、status 白名单、
   effective 派生态只读不写库、时间区间校验、targetUrl 安全、imagePath 存在性校验）→ 8 路由
   （list/new/[id]/reorder 注册顺序注意）。GET 绝不写库。公开读取规则只写注释+文档（P8 接线）。
3. **后端 lines**：name 必填≤255、url 完整 http(s)、**新建默认 disabled**、status 仅 active/disabled
   走 PATCH /lines/[id]/status（复用 lines.update）、PATCH 编辑不含 status、无服务端探测 → 7 路由。
4. **后端 settings**：白名单 key（site_name/site_description/site_logo/site_footer_text/ads_random，
   默认值取 SITE_INFO）、幂等初始化不覆盖、GET 返回 {key:{value,version}}、PATCH 批量逐项校验+逐项
   版本检查、单事务整批成败、logo/favicon 走统一媒体校验禁外部 URL 且文件必须存在、恢复默认=确认后的
   update 非 delete → 2 路由。
5. **审计**：ad.*/line.*/settings.* 动作、before/after 脱敏（token）、同事务；403/409/422 无成功审计。
6. **UI**：/admin/ads（列表+effective 状态 badge+编辑器+图片预览）、/admin/lines（表单+状态操作）、
   /admin/settings（分组+版本保存+确认恢复默认+logo 预览）；导航入口 RBAC 显示。
7. **测试**（p6d.md §13 A–I 矩阵）：migration/CRUD/RBAC4/CSRF/media 安全（存在性、穿越、编码穿越、
   反斜杠、危险扩展、SVG/HTML、外部 http、协议相对、symlink 逃逸）/SSRF 无 fetch/并发（ads 启用、
   lines 编辑、site_name、logo、批量 reorder 冲突回滚）。
8. **前端兼容**：8 个前台路由 200；`src/lib/facai8/data/` SHA 冻结比对。
9. **门禁**：lint / typecheck / build / test:admin 全绿（当前基线 35 文件 558 tests）。
10. **文档**：PLAN 勾选、SCHEMA、SECURITY、IMPLEMENTATION 补 P6D 记录；按 p6d §17 汇报后**停止**（不进 P7）。

## 环境注意

- MySQL **不是 Windows 服务**，机器重启后必须手动拉起：
  `Start-Process "D:\phpEnv-all\phpEnv\server\mysql\mysql-8.0\bin\mysqld.exe" -ArgumentList '--defaults-file="D:\phpEnv-all\phpEnv\server\mysql\mysql-8.0\my.ini"','--datadir="D:\phpEnv-all\phpEnv\server\mysql\mysql-8.0\data"','--console' -WindowStyle Hidden`
  验证：`Get-NetTCPConnection -LocalPort 3306 -State Listen`。
- 凭据在 `docs/mysql数据库信息.md`（gitignored）：127.0.0.1:3306 root/root123456，dev 库 facai8_admin。
  scratch 测试库沿用 `facai8_p6c_test` 命名模式（P6D 可新建 facai8_p6d_test 或复用，test-db.ts 有建库权限预检）。
- 本机曾观测到 dev 库偶发连接异常（2026-11-12 09:19-09:24 一次性 ER_ACCESS_DENIED 窗口，mysqld 未重启、
  无 abnormal audit、账号 host 匹配正常）——未复现即视为 transient，若再发再排查。
- `npm run typecheck` = `next typegen && tsc --noEmit`。

## 已知 P6C 遗留（登记，不在 P6D 处理）

1. 若仓库将公开，需从 .env.local 移除测试凭据。
2. 公开页富文本渲染层建议二次消毒（P8 接线时）。
3. RichTextEditor 保存防抖 / 预览策略（P6C 遗留审计项，P6C 提交里编辑器部分已有改动，恢复时先核对现状）。
