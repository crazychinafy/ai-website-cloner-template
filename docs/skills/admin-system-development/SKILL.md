---
name: admin-system-development
description: 在彩搜搜 Next.js 仓库中分阶段开发基于 MySQL 的管理后台，严格保留现有前台、路由和静态采集 Mock 快照。
---

# Admin System Development Skill

## 0. 角色与执行约束

你是本仓库的资深 Next.js/Node.js/MySQL 工程师。你的任务是按阶段为现有彩搜搜网站增加后台管理功能。

**本 Skill 是执行合同。任何与本文冲突的快捷实现都不得采用。**

### 不可违反的约束

1. 先读 docs/ADMIN_SYSTEM_TECHNICAL_DESIGN.md、docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md、docs/ADMIN_SYSTEM_SECURITY_AND_TESTING.md、docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql。
2. 开始前重新检查 package.json、lockfile、src/app、src/lib/facai8/data、现有 auth、Dockerfile、docker-compose.yml。仓库实际代码优先于文档中的历史统计。
3. 现有前台功能、页面、路由、样式、组件、图标字体和静态数据必须保留。
4. 禁止删除、覆盖、自动格式化重写或重新生成 src/lib/facai8/data/ 下现有采集快照。后台不直接写这些文件。
5. 禁止把静态采集数据替换为临时 mock、新的空数组或硬编码示例数据。
6. 不要将现有会员 Mock Cookie 当成管理员认证。管理员使用独立认证表、独立 Cookie、独立 session 和 RBAC。
7. 所有 MySQL 访问只允许服务端代码。数据库凭据绝不能传入 Client Component、页面 props、浏览器或日志。
8. 不允许在未经数据导入和验证时将 CONTENT_SOURCE 改为 mysql。默认 static。
9. 不允许自动重置、清空、覆盖生产数据库。迁移和导入必须显式执行、可预览、可审计。
10. 不要顺手升级 Next.js/React/Tailwind 或重构前台。
11. 每一阶段结束必须运行规定验证，失败先修复，不得带着失败进入下一阶段。
12. 每一阶段汇报：变更文件、实现内容、命令结果、测试结果、未解决风险。

## 1. 仓库基线

- Next.js 16.3.5 App Router，React 19.2.4，TypeScript strict。
- Node.js >=24，npm。
- Tailwind CSS 4，已有 Base UI/shadcn 风格组件。
- next.config.ts 使用 output: "standalone"。
- 前台现有路由包括 /、/category/[categoryId]、/link/[id]、/articles、/articles/[id]、/bulletin/[id]、/search、/lines、/tag/[tagId]、/login、/register、/profile、/favorites、/my-posts、/my-comments、/submit-article 等。实施前重新枚举。
- 当前数据位于 src/lib/facai8/data/，包括 categories、links、link-order、link-details、link-mirrors、tags、articles、article-categories、bulletins、ads、lines、site-info、icon-libraries、site-static、popup、stats 等。
- 当前前台 Mock 会员认证在 src/lib/facai8/auth.ts、auth-api.ts；它不是可信管理员身份系统。
- 当前仓库没有 MySQL driver/ORM；需新增依赖并锁定版本。
- 现有 Dockerfile 使用 Node 24 standalone；需确认 Drizzle migration 与 MySQL 驱动能在 Node runtime 正常工作。

## 2. 执行前检查清单

开始编码前完成：
- [ ] git status --short，确认工作区用户改动，不覆盖用户工作。
- [ ] git branch --show-current。
- [ ] 读取 package.json、package-lock.json 中的 Node/Next 版本。
- [ ] 列出 src/app 所有 page.tsx 和 route.ts。
- [ ] 列出 src/lib/facai8/data 文件及导出名。
- [ ] 确认所有前台组件依赖的数据字段。
- [ ] 检查是否存在已有 docs 文档，新增文件不得覆盖无关文档。
- [ ] 建立前台基线：npm run lint、npm run typecheck、npm run build；记录失败是原有问题还是本次引入。
- [ ] 记录关键前台页面桌面和移动截图，至少首页、分类页、网址详情、文章列表、文章详情、登录页。
- [ ] 记录静态数据计数和数据摘要：一级/二级分类、网址、详情、备用链接、标签、文章、文章分类、公告、广告、线路。

若基线命令失败，先定位并记录，不要把原有失败误报为本次通过。

## 3. 目标架构

使用单一 Next.js Node.js 应用，不额外创建 Express/Nest 服务。

分层：
- App Router 页面：src/app/admin/**。
- Route Handlers：src/app/api/admin/v1/**。
- UI：src/components/admin/**。
- 业务服务：src/lib/admin/services/**。
- 权限/认证：src/lib/admin/auth/**、permissions/**。
- 校验：src/lib/admin/validation/**。
- Repository：src/lib/admin/repositories/**。
- 数据库：src/lib/db/client.ts、schema/**。
- Drizzle migrations：drizzle/**。
- 静态快照适配器：src/lib/facai8/content/static-repository.ts。
- MySQL 适配器：src/lib/facai8/content/mysql-repository.ts。
- 数据源选择：src/lib/facai8/content/source.ts。
- 脚本：scripts/admin/**。

页面不写 SQL。Route Handler 不直接拼 SQL。所有写操作走 Service -> Repository。

## 4. 技术依赖

推荐组合：
- mysql2：MySQL driver/连接池。
- drizzle-orm + drizzle-kit：schema 和 migration。
- zod：输入和环境变量验证。
- argon2：Argon2id 密码哈希。
- sanitize-html：富文本清洗。
- vitest：单元和集成测试。
- playwright：浏览器端 e2e。

实施前核对 Node 24、Next 16.3.5 的兼容性；使用 npm 安装具体稳定版本并提交 package-lock.json。不要用 latest 浮动版本。不要同时安装 Prisma、TypeORM、Sequelize 等多套 ORM。

## 5. 阶段执行流程

严格按 docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md 中的阶段顺序执行。默认每次只完成一个阶段；用户明确要求继续时才跨阶段。

### Phase 0 — 审计与基线
不写业务代码。完成检查清单、路由地图、数据字段映射、现有 CSS/组件复用评估和基线报告。发现现有文件与文档不符时先更新方案，不猜测。

### Phase 1 — 依赖、配置和数据库基础
- 安装依赖、锁版本。
- 新建 Zod 环境变量 schema。
- CONTENT_SOURCE 默认 static。
- 创建 mysql2 pool，限制连接数，开启 bigNumberStrings/supportBigNumbers。
- 数据库模块使用 server-only，禁止 Client Component import。
- Drizzle schema 与 drizzle.config.ts。
- 迁移文件纳入 Git；禁止应用启动时自动跑 migration。
- 增加 .env.example；确保 .env、.env.local 不提交。
- Docker Compose 的 MySQL 数据卷和应用环境变量分开配置；数据库密码不得硬编码。

验收：无 DB 环境下 static 模式正常启动；有 DB 环境可执行 SELECT 1；lint/typecheck/build 通过。

### Phase 2 — Schema、migration、seed
按 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql 创建 Drizzle schema，字段、索引、FK 和枚举与 DDL 一致。若发现 DDL 缺陷先更新 SQL 文档，再生成 migration。

seed：
- 插入权限字典、系统角色和角色权限。
- 不插入明文密码。
- 初始管理员由单独 bootstrap 命令从环境变量读取，使用 Argon2id hash；命令幂等，已存在管理员时拒绝重置。
- bootstrap 完成后清除初始化密码环境变量并要求首次登录修改密码。

验收：空库 migrate、seed、bootstrap；重复 migrate/seed 安全；无 DB 时静态模式不受影响。

### Phase 3 — 管理员认证与 RBAC
- 路由：/admin/login、/admin/**。
- Cookie：facai8_admin_session，HttpOnly、Secure（生产）、SameSite=Lax、Path=/、合理 Max-Age。
- Session token 使用 crypto.randomBytes(32) 生成；数据库仅存 SHA-256(token) 摘要；原 token 只放 Cookie。
- 每次请求检查 session 未撤销、未过期、管理员 active、密码状态。
- 登录成功轮换 Session；退出时服务端撤销 Session。
- 权限必须在服务端 Service/Handler 校验，不能只隐藏 UI。
- 登录失败限流按用户名哈希和 IP 哈希计数；429 和指数退避；不透露用户名是否存在。
- 对所有写操作执行 Origin/CSRF 校验。
- 不复用现有 facai8_session、getSessionUser、SOURCE_TEST_USERNAME/PASSWORD。

验收：未登录 401/重定向、无权限 403、过期 Session 失效、注销后失效、管理员禁用后立即失效、CSRF 拒绝、登录限流。

### Phase 4 — Repository 和静态数据导入
先定义领域 DTO 和 Repository interface，再写 StaticSnapshotRepository、MySqlRepository。
静态快照导入脚本必须支持：
- --dry-run：只读统计、ID/关系校验、冲突报告。
- --execute：显式写入。
- --snapshot-version：必填版本标识。
- 重复导入默认拒绝；若已导入，要求备份、差异审查和单独确认选项。
- 事务或可恢复批次；写 admin_import_runs。
- 记录数、ID 集合、分类关系、标签关系、文章分类、备用链接关系、CAT_ORDER 顺序、媒体路径校验。
- 所有原始 ID 作为十进制字符串传输；MySQL BIGINT UNSIGNED；Node mysql2 以 string 返回。
- 缺少 LINK_DETAILS 时不创建伪造记录。
- link-order.ts 的排序转成 sort_order；静态快照原始数组顺序作为未覆盖项的稳定后备顺序。
- HTML 内容只做原样迁移；发布前再通过 sanitizer。
- 图片文件不写 BLOB；保存相对路径和媒体元数据。
- 不得无条件 upsert 覆盖管理员已编辑内容。

验收：dry-run 输出报告；测试库导入后校验总数和关系；导入可重复运行但不会覆盖内容；静态文件 Git diff 为零。

### Phase 5 — 后台壳与通用 UI
创建独立 AdminLayout，不套用前台 SiteFrame。包含侧边导航、顶部用户信息、面包屑、内容区、权限菜单、响应式布局。
通用组件：
- DataTable（服务端分页/排序/筛选）
- SearchToolbar
- StatusBadge
- ConfirmDialog
- FormField
- RichTextEditor（清洗规则配套）
- MediaPicker（第一期可只选现有媒体）
- EmptyState、LoadingState、ErrorState
- Toast/操作反馈
列表默认 20 条，允许 20/50/100，最大 100。
验收：桌面、平板可用；无横向溢出；键盘焦点可见；权限菜单隐藏但服务端仍检查。

### Phase 6 — 内容管理 API 与页面
按模块逐个完成，不要并行修改所有资源：
1. 网址分类（两级）。
2. 文章分类。
3. 标签。
4. 网址与详情/备用链接。
5. 文章。
6. 公告。
7. 广告。
8. 线路。
9. 站点设置。
每个模块流程：
- 定义 Zod schema、DTO。
- 实现 Repository 查询和事务写入。
- 实现 Service 业务规则。
- 实现 Route Handler + auth + permission + CSRF。
- 实现列表/新增/编辑/预览。
- 增加单元和 API 集成测试。
- 运行 lint/typecheck/build。
- 回归相关前台路由。
不得直接拼接 SQL 标识符；sortBy 使用 allowlist。所有值参数化。

### Phase 7 — 仪表盘、审计、导入 UI
- 仪表盘只展示真实可得的数据总数、最近修改、导入状态和系统健康；没有访问分析时不得虚构 PV/UV。
- 所有写操作记录 admin_audit_logs，敏感字段（密码、token、Cookie）不得进入 before/after JSON。
- 审计日志只读，支持按用户、资源、动作、时间筛选。
- 导入 UI 先预检，再显示差异和风险，再显式确认；禁止一键覆盖生产数据库。

### Phase 8 — 前台 Repository 切换
只有 Phase 4 导入验证、Phase 6 资源 CRUD、Phase 7 审计通过后才开始。
- 保持 CONTENT_SOURCE=static 默认。
- 实现 getHomeCategories/getLinksByCategory/getLinkById/getLinkDetail/getArticleCategories/getArticles/getArticleById/getBulletins/getAds/getTags/getLines/getSiteSettings。
- 一次迁移一个路由组：先首页/分类，再详情，再文章/公告，再标签/线路。
- 每组先对比 static 和 mysql DTO 结果；字段、顺序、分页和 SEO 行为一致后才切换。
- 任何 MySQL 失败在 mysql 模式下明确报错，不静默 fallback。
- 保留 static adapter 和所有原文件，回滚仅切换环境变量。
- 写操作完成后按路径执行 revalidatePath 或明确的缓存失效策略。

### Phase 9 — 发布与验收
- 执行安全检查和完整测试矩阵。
- 做 MySQL 备份和恢复演练。
- Docker standalone 构建，验证迁移命令在 runner/build 阶段所需文件存在。
- 生产只开放 Nginx 80/443；MySQL 和 Next 3000 不直接暴露公网。
- 初始上线保持 CONTENT_SOURCE=static；管理员登录与 CRUD 稳定后再考虑 mysql 模式。

## 6. 数据库实现要求

DDL 以 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql 为结构基线。重点：
- admin_users、admin_roles、admin_permissions、admin_user_roles、admin_role_permissions、admin_sessions、admin_login_attempts。
- link_categories、article_categories、site_tags、site_links、site_link_details、site_link_mirrors、articles、bulletins、ads、site_lines、icon_libraries、site_pages、site_settings、media_assets。
- admin_audit_logs、admin_import_runs。
- InnoDB + utf8mb4。
- ID 保持 string；不要 Number(id)。
- 外键删除默认 RESTRICT；用户会话可 CASCADE；审计 actor 用 SET NULL。
- 列表字段建索引，状态/删除标记参与查询。
- version 乐观锁；更新时 version 不一致返回 409。
- 所有写入使用事务。
- 迁移脚本必须向前兼容，生产迁移前先备份。

## 7. API 合同

统一前缀 /api/admin/v1。统一响应：

成功：
    { "success": true, "data": {}, "meta": {}, "requestId": "..." }

失败：
    { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": {} }, "requestId": "..." }

必须覆盖：
- auth/login、auth/logout、auth/session
- categories
- links、links/[id]
- articles、articles/[id]
- article-categories
- bulletins
- ads
- tags
- lines
- settings
- administrators
- audit-logs
- imports/preview、imports、imports/[id]

分页最大 100。服务端白名单控制 sortBy。状态码 401/403/404/409/422/429 使用正确语义。不得返回 SQL 或堆栈。

## 8. 完成定义（Definition of Done）

每个模块完成必须：
- [ ] TypeScript strict 无新增错误。
- [ ] ESLint 无新增错误。
- [ ] 对应单元/集成测试通过。
- [ ] 新 API 未登录、无权限、CSRF、非法输入测试通过。
- [ ] 操作成功写审计日志。
- [ ] 列表分页/筛选/空态/错误态正常。
- [ ] 对应前台页面数据与静态基线一致。
- [ ] 没有更改原始静态数据文件。
- [ ] npm run build 通过。
- [ ] 更新实施计划的验收状态。

## 9. Agent 每次回复格式

每个阶段结束时，按以下结构报告：

### 本阶段结果
- 完成项：
- 修改文件：
- 新增数据库迁移：
- 新增 API/页面：

### 验证
- npm run lint：
- npm run typecheck：
- npm run build：
- 单元/集成/e2e：
- 前台回归：

### 风险与后续
- 未完成项：
- 发现的问题：
- 需要用户确认：
- 下一阶段建议：

若工具不可用或数据库无法连接，明确说明未执行的验证，不能伪造成功。
