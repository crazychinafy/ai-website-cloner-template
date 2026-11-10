# 后台管理系统实施计划与验收清单

> 目标：指导本地 Qwen3.8-27B-4bit 分阶段完成后台开发。
> 原则：一阶段一交付；先审计，再实现；静态快照永远保留。

## 阶段总览

| 阶段 | 内容 | 主要交付 | 是否可单独验收 |
|---|---|---|---|
| P0 | 仓库审计与基线 | 路由清单、字段映射、基线报告 | 是 |
| P1 | 依赖、环境变量、MySQL 连接 | DB client、配置校验、Drizzle 初始化 | 是 |
| P2 | Schema、迁移、角色权限 Seed | migrations、bootstrap-admin | 是 |
| P3 | 管理员登录、Session、RBAC | /admin/login、权限中间层 | 是 |
| P4 | 静态快照导入和双 Repository | 导入脚本、校验报告、Repository | 是 |
| P5 | 后台框架和通用 UI | AdminLayout、表格/表单组件 | 是 |
| P6A | 网址分类、文章分类、标签管理 | CRUD + 测试 | 是 |
| P6B | 网址、详情、备用链接管理 | CRUD + 测试 | 是 |
| P6C | 文章、公告管理 | CRUD + 富文本清洗 | 是 |
| P6D | 广告、线路、站点设置 | CRUD + 测试 | 是 |
| P7 | 仪表盘、审计日志、导入管理 UI | dashboard/audit/import pages | 是 |
| P8 | 前台 MySQL 数据源切换 | 逐路由 Repository 迁移 | 每组验收 |
| P9 | 安全验收、部署和恢复演练 | 发布清单、备份恢复报告 | 是 |

**强制策略：** P0-P7 完成后，前台仍应默认使用原静态数据。P8 是独立的可选切换阶段，不得提前执行。

---

## P0：仓库审计与基线

### 工作项
- [ ] 检查 Git 工作区，保护用户未提交修改。
- [ ] 确认 Node、Next、React、npm、lockfile。
- [ ] 扫描全部 src/app 页面和 API 路由。
- [ ] 扫描全部 src/lib/facai8/data 静态快照。
- [ ] 统计数据条数、ID 重复、分类孤儿、文章分类缺失、详情孤儿、备用链接孤儿、图片引用缺失。
- [ ] 记录当前前台页面截图与行为。
- [ ] 执行 lint/typecheck/build，记录已有失败。
- [ ] 明确哪些页面现在是 Mock、空态或静态展示，不将其误判为真实业务能力。

### 验收
- [ ] 输出路由与数据字典。
- [ ] 原始静态文件 Git diff 为零。
- [ ] 基线报告包含命令输出和失败原因。

## P1：依赖与数据库连接

### 工作项
- [ ] 固定兼容版本：mysql2、drizzle-orm、drizzle-kit、zod、argon2、sanitize-html。
- [ ] 新增环境变量 schema。
- [ ] CONTENT_SOURCE 默认 static。
- [ ] 新增 Node.js only MySQL pool，支持 BIGINT string 返回。
- [ ] 增加连接池最大连接数、连接超时、错误处理和优雅关闭策略。
- [ ] DB 模块通过 server-only 防止客户端导入。
- [ ] 增加 drizzle.config.ts。
- [ ] 增加 .env.example，忽略真实 .env/.env.local。
- [ ] Docker 构建上下文排除敏感文件。

### 验收
- [ ] 无 MySQL 环境下 static 模式仍正常启动。
- [ ] 配置 MySQL 时 SELECT 1 成功。
- [ ] 数据库密码不出现在构建产物、浏览器 bundle、日志和 Git diff。
- [ ] lint/typecheck/build 通过。

## P2：数据库 Schema、迁移和 Seed

### 工作项
- [ ] 将 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql 映射为 Drizzle schema。
- [ ] 对比字段类型、索引、外键、枚举和默认值。
- [ ] 生成初始 migration。
- [ ] 创建角色/权限 Seed，Seed 幂等。
- [ ] 实现 bootstrap-admin CLI，环境变量提供初始账号和密码。
- [ ] 使用 Argon2id hash；拒绝明文密码落库。
- [ ] 初始管理员存在时不得静默重置密码。

### 验收
- [ ] 空数据库 migration 成功。
- [ ] 重复 migration 无破坏。
- [ ] Seed 可重复执行。
- [ ] bootstrap 成功创建管理员。
- [ ] bootstrap 二次执行明确拒绝或安全 no-op。
- [ ] 外键和唯一约束按预期工作。

## P3：认证与权限

### 工作项
- [ ] 建立独立 admin Session。
- [ ] 独立 Cookie facai8_admin_session。
- [ ] 登录、登出、Session 查询。
- [ ] 密码修改与首次登录强制修改。
- [ ] RBAC 权限查询与服务端守卫。
- [ ] 登录限流和临时锁定。
- [ ] Origin/CSRF 校验。
- [ ] 管理员禁用/角色变更后 Session 失效或权限立即刷新。

### 验收
- [ ] 未登录无法访问 /admin 私有页面和 API。
- [ ] 无权限用户返回 403。
- [ ] 注销、过期、撤销 Session 失效。
- [ ] 伪造前台 facai8_session 不能进入后台。
- [ ] CSRF、暴力登录测试通过。

## P4：静态快照导入和 Repository

### 工作项
- [ ] 定义领域 DTO 和 Repository interfaces。
- [ ] 实现静态只读 Repository。
- [ ] 实现 MySQL Repository。
- [ ] 开发 --dry-run 导入预检。
- [ ] 开发显式 --execute 导入。
- [ ] 保留所有原始 ID 字符串。
- [ ] 迁移分类树、链接、标签、文章分类、文章、详情、镜像、广告、公告、线路、图标库、站点设置。
- [ ] CAT_ORDER 变成 sort_order，验证相对顺序。
- [ ] 生成导入摘要、校验 checksum、记录 admin_import_runs。
- [ ] 导入不覆盖后台已编辑数据。
- [ ] 记录图片文件引用但不把文件二进制写入 MySQL。

### 验收
- [ ] dry-run 不修改数据库。
- [ ] 导入数据量与静态源一致。
- [ ] 所有 FK 关系验证通过。
- [ ] 链接排序验证通过。
- [ ] 静态文件无改动。
- [ ] 重复导入受到保护。
- [ ] 测试库备份和恢复成功。

## P5：后台 UI 框架

### 工作项
- [ ] 独立 /admin layout。
- [ ] 侧边导航、顶部栏、面包屑。
- [ ] 根据权限显示菜单。
- [ ] DataTable 服务端分页、排序、筛选。
- [ ] SearchToolbar、ConfirmDialog、表单字段、Toast。
- [ ] Empty/Loading/Error/403 状态。
- [ ] 表单字段级校验反馈。
- [ ] 桌面、平板布局。

### 验收
- [ ] 后台不继承前台 SiteFrame。
- [ ] 未授权用户不看到敏感菜单，直接 API 调用仍被拒绝。
- [ ] pageSize 上限 100。
- [ ] 键盘操作和焦点状态正常。

## P6A：分类和标签

- [ ] 网址分类两级树管理。
- [ ] 父子关系校验。
- [ ] 分类排序。
- [ ] 分类停用/软删除。
- [ ] 文章分类管理。
- [ ] 标签管理。
- [ ] 关联数据阻止危险删除。

验收：分类页、标签页 CRUD、权限、审计、并发冲突、前台分类显示回归通过。

## P6B：网址与详情

- [ ] 网址分页、搜索、分类/标签筛选。
- [ ] 新增、编辑、草稿、发布、停用。
- [ ] URL scheme 校验。
- [ ] Logo 选择和预览。
- [ ] 详情补充字段编辑。
- [ ] 备用链接增删排序。
- [ ] 软删除和恢复策略。
- [ ] 并发 version 校验。

验收：/、/category/[categoryId]、/link/[id]、/tag/[tagId] 回归；缺失详情的链接行为不变。

## P6C：文章和公告

- [ ] 文章列表、搜索、分类筛选。
- [ ] 新建/编辑草稿、预览、发布、归档。
- [ ] SEO 字段。
- [ ] 富文本 HTML 清洗。
- [ ] 公告 CRUD、排序和发布状态。
- [ ] 发布/撤回审计。

验收：/articles、/articles/[id]、/bulletin/[id] 回归；XSS payload 无法执行。

## P6D：广告、线路、设置

- [ ] 广告位置、素材、目标 URL、时间窗口、排序、启停。
- [ ] 线路名称、URL、排序、启停。
- [ ] 站点名称、描述、Logo、favicon、页脚设置。
- [ ] 白名单设置键，禁止任意环境配置写入。
- [ ] 图片路径存在性校验。

验收：首页广告、/lines、页面 metadata 和站点品牌字段回归。

## P7：仪表盘、审计、导入

- [ ] 仪表盘仅展示真实统计。
- [ ] 审计日志只读筛选。
- [ ] 写操作记录 actor/action/resource/before/after/requestId/IP。
- [ ] 日志脱敏。
- [ ] 导入预检、差异展示、确认导入和历史记录。
- [ ] 破坏性动作强制二次确认。

验收：所有 CRUD 有日志；失败事务不产生误导性的成功日志；导入记录完整。

## P8：前台数据源切换（最后执行）

### 切换前门槛
- [ ] P4 导入一致性通过。
- [ ] P6 内容管理 CRUD 通过。
- [ ] MySQL Repository 与静态 Repository 的 DTO 形状一致。
- [ ] 已完成数据库和静态文件备份。
- [ ] 已确认生产切换窗口。

### 顺序
1. 首页和分类读取。
2. 网址详情。
3. 文章列表/详情和公告。
4. 标签和线路。
5. 广告与站点设置。

每组变更后做字段、顺序、分页、SEO、空态、404、媒体路径对比。

### 验收
- [ ] static 模式与切换前行为一致。
- [ ] mysql 模式页面行为与静态基线一致。
- [ ] MySQL 不可用时显示明确 5xx/错误，不静默读取旧静态值。
- [ ] 切回 static 可在配置变更和重启后恢复。
- [ ] 原始快照未删除。

## P9：安全、发布和运维

- [ ] 完成 SECURITY_AND_TESTING 文档中的测试矩阵。
- [ ] npm run lint。
- [ ] npm run typecheck。
- [ ] npm run build。
- [ ] Vitest 和 Playwright 测试通过。
- [ ] Docker standalone build 和启动通过。
- [ ] MySQL 备份、恢复演练。
- [ ] 上传目录持久化。
- [ ] Nginx HTTPS、HSTS（确认域名和证书后启用）。
- [ ] MySQL 不暴露公网。
- [ ] 应用数据库用户非 root、最小权限。
- [ ] 首次生产上线 CONTENT_SOURCE=static。
- [ ] 监控数据库连接、5xx、登录失败和磁盘空间。

---

## 每阶段交付报告模板

```text
阶段：
本阶段目标：
完成项：
修改文件：
新增 migration：
新增 API/页面：
lint：
typecheck：
build：
unit/integration/e2e：
前台回归：
数据库状态：
静态快照是否有变化：
遗留风险：
下一阶段建议：
```

## 总体完成标准

后台功能完整可用、RBAC 在服务端强制执行、数据库导入可审计且可恢复、静态快照保留、前台路由无回归、生产部署可备份恢复。没有实际运行的测试不得标记为通过。
