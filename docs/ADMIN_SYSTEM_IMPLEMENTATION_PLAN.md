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

> **执行状态：已完成（2026-11-10），等待用户验收。** 详见 `docs/ADMIN_SYSTEM_P0_AUDIT_REPORT.md`。
> 基线命令 lint/typecheck/build 全部通过（无原有失败）；截图 17 张存 `docs/design-references/facai8/admin-p0-baseline/`；
> 发现问题 F1–F10：F1 本阶段已修正（技术设计文档补 searchDescriptions.ts）；F2 孤儿 CAT_ORDER 条目 → P4 跳过策略（见下）；
> F3 `.env` 被跟踪 / F4 `.gitignore` 残留 `docs/` 规则 / F5 `tsconfig.tsbuildinfo` 被跟踪 → P1 处理；
> F7 compose 无 MySQL 服务 → P1；F8 zod 4.3.6 传递依赖已存在 → P1 固定版本；F9/F10 → P4 决策。

### 工作项
- [x] 检查 Git 工作区，保护用户未提交修改。（干净工作区，master @ f0156d2）
- [x] 确认 Node、Next、React、npm、lockfile。（Node v24.22.2 / next 16.3.5 / react 19.2.4，无 MySQL 依赖）
- [x] 扫描全部 src/app 页面和 API 路由。（21 页面 + 9 API，全部动态渲染）
- [x] 扫描全部 src/lib/facai8/data 静态快照。（20 文件，含文档遗漏的 searchDescriptions.ts）
- [x] 统计数据条数、ID 重复、分类孤儿、文章分类缺失、详情孤儿、备用链接孤儿、图片引用缺失。（60+34 分类 / 3791 网址 / 122 详情 / 66 镜像 / 28 文章；图片 0 缺失；CAT_ORDER 6 孤儿 ID = 快照时间差，导入跳过）
- [x] 记录当前前台页面截图与行为。（17 张桌面/移动截图；11 路由控制台 0 错误）
- [x] 执行 lint/typecheck/build，记录已有失败。（全部通过，无失败项）
- [x] 明确哪些页面现在是 Mock、空态或静态展示，不将其误判为真实业务能力。（会员区 4 页 + 登录/注册/找回 = Mock；其余为静态快照渲染）

### 验收
- [x] 输出路由与数据字典。（报告 §3/§4/§5）
- [x] 原始静态文件 Git diff 为零。（src/ 零改动）
- [x] 基线报告包含命令输出和失败原因。（报告 §8/§10）

## P1：依赖与数据库连接

> **执行状态：已完成（2026-11-10），等待用户验收。** 要点：
> 固定版本 mysql2 3.24.6 / drizzle-orm 0.45.4 / drizzle-kit 0.31.11（dev）/ zod 4.6.7 / argon2 0.45.2 / sanitize-html 2.18.1 / server-only 0.0.1 / @types/sanitize-html 2.16.0（dev）（lockfile 已提交）；
> 新增 `src/lib/admin/validation/env.ts`（Zod，CONTENT_SOURCE 默认 static）、`src/lib/db/client.ts`（server-only 惰性 mysql2 池，bigNumberStrings）、`src/lib/db/schema/`（P2 占位）、`drizzle.config.ts`、`scripts/admin/db-check.mjs`、`.env.example`；
> 仓库卫生 F3/F4/F5 已修（.env 与 tsconfig.tsbuildinfo untrack；.gitignore 重写：docs/* 忽略克隆档案但保留 admin 文档，.env* 入库规则）；.dockerignore 保留 scripts/admin；docker-compose 增加 mysql 8.0 服务 + 独立数据卷（密码经 env 注入）。
> 验收：无 DB 生产启动 7 路由 200；本地 MySQL 8.0.31 SELECT 1 OK（BIGINT 20 位字符串无损）；凭据在 .next/Git diff/源码 三层 0 泄漏；lint/typecheck/build 全绿；npm audit 高危项均为模板树既有（next 16.3.5 advisory 等，按约束 10 不升级，P9 决策）。

### 工作项
- [x] 固定兼容版本：mysql2、drizzle-orm、drizzle-kit、zod、argon2、sanitize-html（+ server-only、@types/sanitize-html；版本见上，argon2 原生模块 Node 24 hash 验证通过）。
- [x] 新增环境变量 schema（`src/lib/admin/validation/env.ts`：CONTENT_SOURCE/DB_*/ADMIN_*/UPLOAD_DIR；Zod 白名单键解析，static 不抛错、mysql fail-fast、不打印值）。
- [x] CONTENT_SOURCE 默认 static（schema default + compose 默认 + .env.example 注释）。
- [x] 新增 Node.js only MySQL pool（`src/lib/db/client.ts`：惰性单例、bigNumberStrings/supportBigNumbers、UTF8MB4）。
- [x] 增加连接池最大连接数（DB_POOL_SIZE 1-50）、连接超时 10s、错误监听（仅错误码）、closeDb() 优雅关闭。
- [x] DB 模块通过 server-only 防止客户端导入（`import "server-only"`；包语义验证：default 条件抛错/react-server 条件空操作，生产构建通过）。
- [x] 增加 drizzle.config.ts（dialect=mysql；kit 加载验证：0 表空 schema，无迁移，exit 0）。
- [x] 增加 .env.example；.env/.env.local 加入 ignore 并从索引移除（文件保留磁盘）。
- [x] Docker 构建上下文排除敏感文件（.dockerignore 已含 .env*；scripts 排除修正为仅 scripts/facai8）；docker-compose 增加 mysql 8.0 服务（独立 mysql-data 卷、默认不暴露公网、密码 ${DB_PASSWORD} 注入、healthcheck）。

### 验收
- [x] 无 MySQL 环境下 static 模式仍正常启动（生产构建 `next start` 无 DB_* 变量：/、/articles、/login、/link/[id]、/category/[id]、/articles/[id]、/lines 全 200；next start + standalone 警告为模板既有行为，容器正规入口 node server.js）。
- [x] 配置 MySQL 时 SELECT 1 成功（本地 127.0.0.1:3306 MySQL 8.0.31，scripts/admin/db-check.mjs；BIGINT UNSIGNED 20 位以字符串返回，无精度损失）。
- [x] 数据库密码不出现在构建产物、浏览器 bundle、日志和 Git diff（.next 全量递归 + 暂存/未暂存 diff + 源码/配置文件三层检索 0 命中；db-check 输出仅 host/user/db/version）。
- [x] lint/typecheck/build 通过（typecheck 首轮 1 错：mysql2 Pool 事件类型重载，已按 EventEmitter 断言修复）。

## P2：数据库 Schema、迁移和 Seed

> **执行状态：已完成（2026-11-10），等待用户验收。** 要点：
> 23 张表 → Drizzle schema（`src/lib/db/schema/` 14 模块 + 统一 index 出口）；1 个版本化迁移 `drizzle/0000_fair_magdalene.sql`（kit 0.31.11 生成 + `scripts/admin/patch-migration.mjs` 幂等补丁：13 个 `updated_at` 补 `ON UPDATE CURRENT_TIMESTAMP(3)`、23 个 CREATE 补显式 InnoDB/utf8mb4；全文无 DROP/TRUNCATE）；
> CLI：`npm run db:migrate`（建库 + drizzle migrator，facai8_* 库名白名单）/ `admin:seed`（42 权限 / 4 角色 / 108 映射，幂等）/ `admin:bootstrap`（Argon2id、must_change_password=1、super_admin 关联）；
> 测试：vitest 5.1.0 `npm run test:admin` 五套 34/34 全绿（真实 MySQL scratch 库：schema 结构 / migration 行为 / seed 幂等 / bootstrap / 17-20 位 BIGINT 精度）；lint 0 告警、typecheck、build 全绿。
> 真实库 `facai8_admin`：24 表 + journal 1 条 + seed 42/4/108，角色映射 super_admin=42 / content_admin=32 / content_editor=22 / auditor=12，`admin_users=0`；**真实库 bootstrap 未执行**（用户未提供管理员凭据，遵守"不得伪造管理员已创建"，留待 P3 登录联调时由用户提供 env 执行）。
> 静态快照 `src/lib/facai8/data/` 零 diff。
> 工程决策（drizzle-orm 0.45.4 API 差异均实测验证）：全部 DATETIME(3) 用 `{ mode: "string", fsp: 3 }`（墙钟字符串无损往返）+ 池 `timezone: "Z"`；BIGINT 一律 `bigint(name, { mode: "bigint" })`（JS BigInt，20 位无损）；`link_categories.parent_id` 自引用 FK 用表级 `foreignKey()` 约束（规避列级自引用在 strict 下的类型循环）；0.45.4 无 `bigintUnsigned`/`defaultRaw`/MySQL `insert.returning()`，分别以 config 对象、`sql` 模板、唯一键回查替代。
> DDL 文档缺陷修正：`site_tags.created_at` 误带 `ON UPDATE CURRENT_TIMESTAMP(3)`，已同步修正 `docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql`。

### 工作项
- [x] 将 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql 映射为 Drizzle schema（14 模块 / 23 表 / 统一出口；DDL 文档缺陷先修正后生成）。
- [x] 对比字段类型、索引、外键、枚举和默认值（`schema.test.ts` 对 information_schema 逐项核对：含 2 个组合主键、8 个唯一索引、14 个普通索引、16 条 FK 删除规则、13 个毫秒 ON UPDATE、引擎/字符集、ENUM/JSON/LONGTEXT/VARBINARY 类型）。
- [x] 生成初始 migration（23 个 CREATE，无 DROP/TRUNCATE，FK 后置 ALTER 保证顺序；补丁脚本幂等可重跑，第二跑 0 处修改）。
- [x] 创建角色/权限 Seed，Seed 幂等（唯一 code upsert；系统角色映射同事务重算；非系统角色与管理员数据从不触碰——seed.test.ts 验证）。
- [x] 实现 bootstrap-admin CLI，环境变量提供初始账号和密码（缺密码/短于 12 位/弱口令命中均拒绝，无默认回退）。
- [x] 使用 Argon2id hash；拒绝明文密码落库（scratch 库实测：hash 为 `$argon2id$` 前缀，全文检索无明文）。
- [x] 初始管理员存在时不得静默重置密码（二次执行 = 安全 no-op，密码哈希逐字节不变，用户数不变；用户名冲突拒绝）。

### 验收
- [x] 空数据库 migration 成功（scratch 库：23 表 + `__drizzle_migrations`）。
- [x] 重复 migration 无破坏（连跑 3 次：表数/数据/journal 条数不变）。
- [x] Seed 可重复执行（二次执行不产生重复：42/4/108 恒定）。
- [x] bootstrap 成功创建管理员（scratch 库：Argon2id + must_change_password=1 + super_admin 关联；输出对象不含明文密码/hash）。
- [x] bootstrap 二次执行明确拒绝或安全 no-op（`already_bootstrapped`，exit 0）。
- [x] 外键和唯一约束按预期工作（RESTRICT 阻止删除被引用父行 errno 1451；删除网址级联删详情/备用链接；删除管理员 SET NULL；唯一约束生效）。
- [ ] 生产 `facai8_admin` 上的 bootstrap（待用户：提供 `ADMIN_BOOTSTRAP_USERNAME/PASSWORD` 后执行 `npm run admin:bootstrap`；当前真实库 `admin_users=0`，未创建、未伪造）。

## P3：认证与权限

> **执行状态：已完成（2026-11-10），等待用户验收。** 要点：
> 服务端 Session（`crypto.randomBytes(32)` → base64url；DB 只存 SHA-256 摘要；HttpOnly Cookie `facai8_admin_session`，Secure=production、SameSite=Lax、Path=/、Max-Age=TTL（默认 12h，env 上限 720h），不设 Domain）；
> 登录 `POST /api/admin/v1/auth/login`（Origin 白名单 + JSON + Zod + 限流前置 + Argon2id + 不存在账号哑验证时序均衡 + active/未软删除资格 + 统一错误文案 + last_login_at + 登录即轮换防 Fixation）；
> 会话 `GET /api/admin/v1/auth/session`（角色/权限每次请求实时查库 + CSRF token；未登录 401；不含 token/hash）；注销 `POST .../logout`（幂等；有效 Session 需 CSRF → 撤销 DB + 清 Cookie）；改密 `POST .../change-password`（Session+CSRF+策略 12-128+弱口令表+旧密码 → 事务[改哈希/清 must 标志/撤销全部 Session/审计] → 轮换新 Session）；
> RBAC：统一守卫 `permissions/require-permission.ts`（requireAdminSession/requireAdminPermission/getCurrentAdmin，401/403/CHANGE_PASSWORD_REQUIRED）+ 页面守卫 `auth/guards.ts`（(protected) 布局 redirect；(auth) 组独立避免重定向循环）；权限数量与 P2 Seed 字典实测核对（42/32/22/12）；
> CSRF：SameSite=Lax + Origin 同源/白名单（`ADMIN_ALLOWED_ORIGINS`，* 拒绝、非法配置 fail-closed）+ `X-CSRF-Token`（HMAC-SHA256(ADMIN_CSRF_SECRET, token_hash)，timingSafeEqual）；生产未配密钥 → 认证操作 401 fail-closed；
> 限流：`admin_login_attempts` 15 分钟窗口（用户名+IP ≥5 或 IP ≥20 失败 → 429 + Retry-After；只计失败、无永久锁号；24h 过期清理随每次登录尝试执行）；
> 测试：vitest 六套 49/49 全绿（登录 13 / 限流 7 / 会话 8 / CSRF 7 / 权限 7 / 数据安全 7，真实 MySQL scratch 库 `facai8_p3_test`，与 P2 的 `facai8_p2_test` 隔离；P2 五套 34/34 不受影响，合计 83/83）；lint 0 告警、typecheck、build 全绿；13 条前台路由回归 200、静态数据目录零 diff。
> 工程决策（实测验证）：drizzle 0.45 mysql2 对 DATETIME 走 `field.string()` 原样读回 → UTC 墙钟字符串无损往返，时间比较全部落在 SQL；varbinary 列被 drizzle 声明为 string → IP 以 `X'<hex>'` 字面量写入（`sql.raw`，无注入面）；0.45 无 `isFalse` → `eq(col, false)`。

### 工作项
- [x] 建立独立 admin Session（`src/lib/admin/auth/session.ts`：创建/验证/撤销/全撤销；每次请求查库，禁用/撤销/过期/软删除即时生效）。
- [x] 独立 Cookie facai8_admin_session（`auth/cookies.ts`；与前台 facai8_session 完全隔离，前端组件不读不存 token）。
- [x] 登录、登出、Session 查询（`services/admin-auth-service.ts` + 4 个 route：login/logout/session/change-password，均 `runtime="nodejs"` + force-dynamic）。
- [x] 密码修改与首次登录强制修改（策略 12-128 + 弱口令表；事务内撤销该管理员全部 Session + 审计；登录成功按 must_change_password 决定跳 /admin 或 /admin/change-password；改密后轮换新 Session）。
- [x] RBAC 权限查询与服务端守卫（`permissions/permissions.ts` 实时加载 + `permissions/require-permission.ts` 统一 401/403；页面级 `auth/guards.ts` + (auth)/(protected) route groups，无 middleware）。
- [x] 登录限流和临时锁定（`auth/login.ts`：admin_login_attempts 双维度计数 + 429/Retry-After + 成功留痕 + 24h 清理；无永久锁号）。
- [x] Origin/CSRF 校验（`auth/csrf.ts`：同源恒放行 + 白名单 + HMAC 派生 token + 常量时间比较 + 非法配置 fail-closed；登录/注销/改密全覆盖）。
- [x] 管理员禁用/角色变更后 Session 失效或权限立即刷新（verifySession 每请求重查 user 状态与角色权限；测试 6/8 覆盖）。

### 验收
- [x] 未登录无法访问 /admin 私有页面和 API（(protected) 布局 redirect /admin/login；API 401；生产服务器冒烟验证）。
- [x] 无权限用户返回 403（editor 直调 administrators.update / 移除角色后 links.read，均 403 实时生效）。
- [x] 注销、过期、撤销 Session 失效（会话套件 4/5/7；改密后全部旧 Session 撤销）。
- [x] 伪造前台 facai8_session 不能进入后台（单独伪造 401；与管理员 Cookie 并存时只认管理员身份）。
- [x] CSRF、暴力登录测试通过（CSRF 7 例 + 限流 7 例，含生产未配密钥 fail-closed、通配符白名单拒绝）。

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
