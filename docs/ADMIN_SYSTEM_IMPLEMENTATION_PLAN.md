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

> **执行状态：已完成（2026-11-10），等待用户验收。** 静态数据已导入 `facai8_admin`（4182 行 / 13 表，单事务提交，`admin_import_runs#1 = succeeded`）；双 Repository 一致性验证 exit 0（13 类型 + 3 派生全一致）；测试 132/132 通过；typecheck / lint / build 全绿；前台静态模式回归 12/12 页通过。`src/lib/facai8/data/` 冻结源零改动，前台仍默认 CONTENT_SOURCE=static（P8 才切换）。

### 工作项
- [x] 定义领域 DTO 和 Repository interfaces。（`src/lib/facai8/content/types.ts` + `repository.ts`）
- [x] 实现静态只读 Repository。（`static-repository.ts`，只读冻结源，无 DB 依赖）
- [x] 实现 MySQL Repository。（`mysql-repository.ts` + 8 个 mappers；mapper 层做 BIGINT→字符串、日期规范化、软删除过滤）
- [x] 开发 --dry-run 导入预检。（`scripts/admin/import-static-snapshot.ts`；零写入，含 admin_import_runs）
- [x] 开发显式 --execute 导入。（必须 `--execute` 且 `--confirm-database` 与实际库名完全一致）
- [x] 保留所有原始 ID 字符串。（17/18 位 ID 全流程字符串；217/266 个 18 位 ID 经 Number 化会失真，全走字符串路径）
- [x] 迁移分类树、链接、标签、文章分类、文章、详情、镜像、广告、公告、线路、图标库、站点设置。（13 表 4182 行；详情 122 条仅源站有档，缺失不伪造）
- [x] CAT_ORDER 变成 sort_order，验证相对顺序。（每分类稠密排名 0..n-1；90 个有链接分类三维一致：总数/集合/顺序）
- [x] 生成导入摘要、校验 checksum、记录 admin_import_runs。（checksum = 251537…915f；summary_json 含 13 表行数）
- [x] 导入不覆盖后台已编辑数据。（内容表非空且无匹配成功记录 → 拒绝；同版本同 checksum 已成功 → 安全 no-op）
- [x] 记录图片文件引用但不把文件二进制写入 MySQL。（logo/preview/cover/css 均为字符串路径，物理文件仍在 public/）

### 验收
- [x] dry-run 不修改数据库。（回查 13 表全 0 行、admin_import_runs 0 行）
- [x] 导入数据量与静态源一致。（导入后回查与快照计划逐表相等）
- [x] 所有 FK 关系验证通过。（import fail-fast 守卫 + verify 0 孤儿）
- [x] 链接排序验证通过。（p4-ordering 套件 + verify 顺序差异=0；标签页网格序为已知限制，见下）
- [x] 静态文件无改动。（`src/lib/facai8/data/` 20 个文件零改动，git status 可证）
- [x] 重复导入受到保护。（真实库复跑一次 → no-op，行数不变、无新增记录）
- [x] 测试库备份和恢复成功。（scratch `facai8_p4_test` 自动建库/迁移/删库；132/132 测试通过）

### 交付物
- `src/lib/facai8/content/`（13 文件）：types / dates / repository 接口 / static-repository / mysql-repository / source（P8 注入点，server-only，前台未接入）/ 8 mappers
- `scripts/admin/`：`inspect-static-data.ts`（审计）、`import-static-snapshot.ts`（导入 CLI）、`verify-static-import.ts`（§11 一致性验证）
- `test/admin/`：p4-harness + 5 套件（static / import / parity / bigint / ordering）
- `package.json`：`admin:data:inspect`、`admin:import:preview`、`admin:import`、`admin:import:verify`

### 已知限制（如实记录，不掩盖）
1. **标签页网格序**：P2 schema 单 `sort_order` 列无法同时编码分类序与标签序（同一链接两个维度）。MySQL 侧标签查询 = (sort_order, id)；静态侧 = TAG_ORDER 优先。集合+字段零差异，顺序有差异（108 条差 67 位 / 20 条差 17 位 / 15 条差 14 位）。verify 如实报告为 knownLimitation。若要 P8 前完全对齐需 schema 变更（新增标签序列），属 P5+ 决策。
2. **详情/镜像无全局顺序**：两者均为逐链接查询（前台恒按 linkId 请求），全集遍历序两侧不同（档案序 vs 库序），verify 按 knownLimitation 处理；链内顺序（镜像 sort_order）严格一致。
3. **文章 published_at**：源站 createdAt 落入 published_at；审计 updated_at 承载源 updatedAt（schema 无 source_updated_at 列，无损承载）。
4. **文章 categoryName**：快照列 category_name_snapshot 存源站值（13/28 篇与分类现名不一致的历史事实，如实保留）。

## P5：后台 UI 框架

> **执行状态：已完成（2026-11-11），等待用户验收。** 要点：
> 独立后台框架全部落地且与前台彻底隔离——`(protected)/(auth)` 独立 route group + 自绘 AdminShell（侧边导航/顶部栏/面包屑），不复用前台 SiteFrame/Header；Tailwind v4 入口 + `@theme` 设计令牌只存在于 `src/components/admin/admin.css`（仅 admin 文档导入），前台产物字节级不变（10 路由回归 200 + `src/lib/facai8`/`globals.css`/`layout.tsx`/`public` git diff 为空）；
> 菜单由 Session 权限驱动（`lib/admin/ui/navigation.ts` buildNav；**菜单隐藏 ≠ 授权**，服务端守卫 `require-permission` 是唯一安全边界，p5-permissions 用真实 MySQL 四角色 42/32/22/12 实测核对）；未实现模块以「待开放」占位、无死链；首页无任何伪造业务统计（只展示真实数据源/会话/权限规模）；
> 核心 UI 组件：DataTable（受控 state 上抛；服务端分页 20/50/100、clamp 上限 100；服务端排序只上抛不本地重排；Loading 骨架/Empty/Error+requestId/行点击键盘可达）、SearchToolbar（关键词回车+下拉多条件+重置+loading 防重复）、ConfirmDialog（ESC/焦点归还/loading 锁闭/危险确认）、FormField 套件（字段级错误定位）、后台专属 ToastProvider（四类型、aria-live、最多 4 条防堆积；不复用前台 ToastHost）；
> 测试：`test/admin` 8 套 P5 组件/权限套件 75 条（happy-dom + 真实 MySQL scratch `facai8_p5_test`），全量 **207/207（24 文件）全绿**，P0–P4 基线 132 条不受影响；`package.json` 新增 devDependency `happy-dom`（DOM 组件测试需要，属预期变更）；lint 0 告警、typecheck、build 全绿；
> 实机走查（Playwright，独立截图库 `facai8_p5_dev`：迁移 24 表 + Seed + bootstrap `p5review`）发现并修复 **4 个真实运行链路缺陷**（详见交付物下「实机缺陷修复」）：safeReturnTo 服务端调用 500、(auth) SSR useToast 抛错、(auth) 组守卫覆盖改密页造成首登自 307 死循环、改密客户端漏传 confirmPassword + zod 原始消息外泄；
> 截图 7 张存 `docs/design-references/p5-admin-*.png`（登录 1440 / 强制改密 1440 / 首页 1440·1024·768·390 / 移动端抽屉 390；`docs/*` 被 .gitignore 忽略，属本地产物；截图由 agent Playwright 工具在真实浏览器视口下采集）；仓库无 Playwright e2e 基建，**e2e = 未执行**（如实记录，不替代组件测试结论）。

### 工作项
- [x] 独立 /admin layout。（`(protected)/layout` requireAdminPage + AdminShell；`(auth)/layout` 无守卫 + ToastProvider；admin.css 独立设计系统，Tailwind 仅 admin 生效）
- [x] 侧边导航、顶部栏、面包屑。（AdminSidebar 分组折叠/权限过滤/小屏抽屉；AdminTopbar 用户菜单含登出；AdminBreadcrumb 由路由元生成）
- [x] 根据权限显示菜单。（buildNav 以 Session 权限集过滤；隐藏≠授权——越权直调 API 仍 403/CHANGE_PASSWORD_REQUIRED；未实现模块「待开放」占位）
- [x] DataTable 服务端分页、排序、筛选。（受控组件只上抛 state；pageSize 20/50/100、clamp 上限 100；排序 asc→desc→取消、`aria-sort` 挂 `th`；Loading/Empty/Error+requestId；行点击键盘可达；小屏表格局部横向滚动）
- [x] SearchToolbar、ConfirmDialog、表单字段、Toast。（回车/搜索/多条件/重置/防重复；ESC+焦点归还+危险确认+loading 锁闭；FormField/Select/Textarea 字段级错误；四类型 aria-live 全局 Toast、手动关闭、最多 4 条）
- [x] Empty/Loading/Error/403 状态。（EmptyState/ErrorState/表内骨架；`/admin/forbidden` 独立 403 页 + API 403 统一文案）
- [x] 表单字段级校验反馈。（api-client 解析字段错误 → FormField 定位展示；zod `invalid_type` 内部消息中性化为「参数格式不正确」，不外泄框架原文）
- [x] 桌面、平板布局。（1440/1024/768/390 四档截图验证：卡片自适应列数、侧边栏折叠、移动端汉堡抽屉、表格横向局部滚动）

### 验收
- [x] 后台不继承前台 SiteFrame。（AdminShell 自绘；登录/改密/首页/403 均独立布局；前台 10 路由回归 200 OK，冻结源与前台样式 git diff 为空）
- [x] 未授权用户不看到敏感菜单，直接 API 调用仍被拒绝。（buildNav 权限矩阵：四角色 42/32/22/12 与 Seed 一致；editor/auditor 无系统管理菜单，直调 `administrators.*` 实时 403）
- [x] pageSize 上限 100。（clampPageSize 单测 + DataTable 切换 50/100 页码重置；服务端独立校验）
- [x] 键盘操作和焦点状态正常。（表头排序 Enter/Space、行 Enter 触发、ConfirmDialog ESC 关闭+焦点归还默认焦点、Toast aria-live=polite、所有交互元素 focus-visible 可见）

### 实机缺陷修复（走查发现，均在 P5 源码内）
1. `safeReturnTo` 原在 `"use client"` 的 api-client 中，被服务端页面组件调用 → `/admin/login` 500。抽为同构纯函数 `src/lib/admin/ui/return-to.ts`（服务端页面直接导入；api-client 再导出保持客户端导入路径不变）。
2. `useToast` 在 (auth) 页面 SSR 期无 Provider 抛错 → (auth) layout 统一包裹 `ToastProvider`（服务端渲染期上下文恒存在）。
3. `guardLoginPage` 原在 (auth) layout，覆盖改密页 → mustChange 用户登录后被整页跳 `/admin/change-password` 又被守卫跳回同页，自 307 死循环（ERR_TOO_MANY_REDIRECTS）。守卫移至仅 `/admin/login` 页面，改密页保留自身未登录守卫。
4. `adminApi.changePassword` 漏传 `confirmPassword`（服务端 Zod 三字段 strict 合同）→ 422；且 zod 4 `invalid_type` 原始消息（"Invalid input: expected string, received undefined"）外泄到 UI。客户端改发全三字段；`zodFields` 将 `invalid_type` 中性化为「参数格式不正确」（自定义 min/max/refine 消息原样保留）。

## P6A：分类和标签

> **执行状态：已完成（2026-11-11），等待用户验收。** 要点：
> 三个内容管理模块全部落地——`/admin/categories`（两级树：新建/编辑/移动、同级 ↑↓ 排序、停用一级级联停用其下二级、启用二级要求上级已启用、软删除与「含已删除」恢复、真实网址/子分类计数）、`/admin/article-categories`（平铺列表，独立资源，删除范围筛选）、`/admin/tags`（前景/背景色取色器 + HEX 输入 + 实时样式预览芯片）；全部复用 P5 的 DataTable/SearchToolbar/FormField/ConfirmDialog/Toast 与状态约定；
> 架构按 Route → 认证+RBAC → Zod → Service → Repository → Drizzle/MySQL 分层，三资源各自独立 Service/Repository；**所有写操作在单一事务内完成且同事务写入审计行**（`category.*`/`article_category.*`/`tag.*` 动作，reorder 审计 resourceId 为 `root`/`global`）；乐观锁 `version` 冲突返回 409 `VERSION_CONFLICT`（「该记录已被其他管理员修改，请刷新后重新编辑」）；409 校验失败路径不写审计；
> 删除保护覆盖含软删除引用：`CATEGORY_HAS_LINKS`/`CATEGORY_HAS_CHILDREN`/`CATEGORY_RESTORE_BLOCKED`（二级须待一级先恢复）/`ARTICLE_CATEGORY_HAS_ARTICLES`/`TAG_HAS_LINKS`，内容表无物理 DELETE；新增 `article_categories.{read,create,update,delete}` 4 权限，总 46 权限/120 角色映射（super=46、content_admin=36、content_editor=25、auditor=13），seed 幂等；
> 迁移 `0001_spotty_lord_tyger.sql` 将 `link_categories`/`article_categories`/`site_tags` 主键 id 改为 `AUTO_INCREMENT`（`SET FOREIGN_KEY_CHECKS` 包裹，journal idx 1），新建行 id = 雪花最大值+1（实机验证），前台数据不动；
> 测试：全量 `npm run test:admin` **29 文件 / 328 用例全绿**（P0–P5 基线 207 + P6A 新增 121，真实 MySQL scratch 库）；lint 0 告警、typecheck、build 全绿；`admin:import:verify` 对 `facai8_p5_dev` 13 表 + 派生视图字段差异=0（details/mirrors 顺序差异为既定已知限制）；
> 前台零回归：6 条前台路由 200；`src/lib/facai8/data` 20 个静态文件 SHA-256 与基线 20/20 一致；`src/lib/facai8`、`public`、`globals.css`、`layout.tsx` git diff 为空；
> 实机走查（浏览器，`facai8_p5_dev` 导入 4182 行快照）：三模块创建（新 id = max+1 证明 AUTO_INCREMENT 生效）、编辑乐观锁版本递增、停用/启用级联与拦截 toast、排序交换、四类删除保护 toast 文案、软删除→含已删除→（先父后子）恢复全链路、缺 CSRF 头 403 `CSRF_INVALID`、过期 version 409 `VERSION_CONFLICT` 且库内数据未变；`admin_audit_logs` 实得 26 条与操作一一对应、409 路径 0 写入；截图 `docs/design-references/p6a-{categories-list,categories-restore,article-categories,tags}.jpg`。

- [x] 网址分类两级树管理。
- [x] 父子关系校验。
- [x] 分类排序。
- [x] 分类停用/软删除。
- [x] 文章分类管理。
- [x] 标签管理。
- [x] 关联数据阻止危险删除。

验收：分类页、标签页 CRUD、权限、审计、并发冲突、前台分类显示回归通过。

## P6B：网址与详情

> **执行状态：已完成（2026-11-11），等待用户验收。** 要点：
> `/admin/links` 列表（3,791 行快照关键词/分类/标签/状态筛选、服务端排序分页、点击数/更新时间列、「含已删除」回收站视图）+ 宽对话框表单（max-w-3xl，**未按原计划做 `/links/new`、`/links/edit/[id]` 子页，改用与 P6A 一致的 dialog 形态**）：基本信息 + 详情补充开关 + 备用链接全量编辑（增删/↑↓/上限 20）；
> 聚合 PATCH 契约：`detail` 缺省=不改、`null`=删除、对象=新建/覆盖；`mirrors` 数组=全量替换（编辑既有行按 id 归属校验，非本链接 id 422）；聚合任一子表变化即 bump 父级 `version`；普通 PATCH 无 status 字段，状态只走 `PATCH /status`（需 `links.publish`）；`sourceSnapshot`/`isGone` 不可编辑；POST 恒为草稿、`sourceSnapshot=false`，`sortOrder` 缺省 = 未删除全局 max+1；
> URL 校验仅 http/https（拒 `javascript:`/`data:`/`file:`/`vbscript:`、控制字符、内嵌凭据、`//` 协议相对）；logo/preview 允许空、站内 `/...` 或绝对 http(s)（快照 1 行绝对 logo 兼容）；`detailHtml` 走首个服务端白名单清洗器 `src/lib/admin/validation/html-sanitize.ts`（无 script/iframe/事件属性/javascript: 协议；P6C 复用），zod 20,000 字符上限低于 64KB body 限制；
> 状态机 draft↔published、draft/published→disabled、disabled→published，其余 422 `LINK_STATUS_TRANSITION`（同态提交 422）；publish 重新校验分类+标签可用（409 `CATEGORY_NOT_USABLE`/`TAG_NOT_USABLE`）；软删除保留详情/备用链接、恢复重校验分类标签（409 `LINK_RESTORE_BLOCKED`）且保留原状态；所有写路径 version+1、同事务审计 `link.{create,update,publish,disable,unpublish,soft_delete,restore}`（detail 审计只记字段名不记正文）；
> 迁移 `0003_furry_hydra.sql` 将 `site_links.id` 转 `BIGINT UNSIGNED AUTO_INCREMENT`（`SET FOREIGN_KEY_CHECKS` 包裹，journal idx 3），快照 17/18 位显式 id 原样保留、新行自增（实机 `...33`→`...40` 连号验证）；DTO id 以十进制字符串往返（浏览器 JS 精度下 UI 仍显示完整 id）；
> RBAC 复用既有 `links.{read,create,update,publish,delete}`：editor=读/建/改（状态、删除、恢复 403）、auditor=只读、status 端点单独 `links.publish`、restore 单独 `links.delete`，API 层强制并覆盖测试；不自动抓取提交的 URL（无反向代理请求，SSRF 面为零）；
> 测试：全量 `npm run test:admin` **31 文件 / 411 用例全绿**（P6A 基线 344 + P6B 新增 65 + 面包屑 +1；`p6b-links-schema.test.ts` 25 + `p6b-links-api.test.ts` 40，真实 MySQL scratch 库 `facai8_p6b_test`）；lint 0 告警、typecheck、build 全绿（新增 `/admin/links` + 4 个 `/api/admin/v1/links*` 路由）；
> 既有测试更新（断言对象已被 P6B 合法改变）：`p5-breadcrumb.test.ts` 测试 6 改为断言 `/admin/links` 完整面包屑（+6b 用 `/admin/articles` 保留未开发回退断言）、`p6a-autoinc.test.ts` site_links 断言改为 EXTRA 含 auto_increment、`migration.test.ts` 迁移计数 3→4；
> 前台零回归：前台页面/CSS/路由零改动；`src/lib/facai8/data/` 20 个冻结文件 SHA-256 与基线 20/20 一致、git diff 为空；`CONTENT_SOURCE` 仍为 static（未切 mysql）；
> 实机走查（浏览器 `http://localhost:3000`，`facai8_admin`，super_admin 登录）：列表渲染 3,791 行、新建对话框 POST 草稿 200、行内「发布」`PATCH /status` 200（v1→v2、下架/停用按钮出现）、「删除」确认框 → DELETE 200 行消失、「含已删除」视图「已删除」徽标 + 「恢复」确认 → POST restore 200（v4、动作列恢复）、编辑对话框（分类/标签下拉加载真实选项）填写详情标注 + 新增备用链接 → `PATCH /links/[id]` 200（v4→v5，响应含 detail+mirrors，toast「已更新」）；审计 `link.*` 12 条与操作对应；
> 开发库遗留（供验收复核）：`facai8_admin` 保留 1 条冒烟记录 `P6B冒烟_测试网址`（id `112546110991634433`，published v5，含 1 条详情标注与 1 条备用链接；走查中脚本误触产生的 7 条重复草稿已连带子表物理清除），走查引导账号 `smokeadmin`（super_admin，Argon2id，`must_change_password=0`）保留。

- [x] 网址分页、搜索、分类/标签筛选。
- [x] 新增、编辑、草稿、发布、停用。
- [x] URL scheme 校验。
- [x] Logo 选择和预览。
- [x] 详情补充字段编辑。
- [x] 备用链接增删排序。
- [x] 软删除和恢复策略。
- [x] 并发 version 校验。

验收：/、/category/[categoryId]、/link/[id]、/tag/[tagId] 回归；缺失详情的链接行为不变。

## P6C：文章和公告

- [x] 文章列表、搜索、分类筛选。（q=标题/作者，categoryId/status/删除范围筛选，分页 20/50/100，列排序 allowlist，默认更新时间降序 + id 并列键）
- [x] 新建/编辑草稿、预览、发布、归档。（6 个子页：列表 / 新建 / 编辑 各两套；创建恒为草稿；`POST /articles/preview` 服务端清洗预览；状态机 draft→published/archived、published→archived、archived→published，再发布保留原 `published_at`（COALESCE），草稿 `published_at=NULL`）
- [x] SEO 字段。（seoTitle/seoKeywords/seoDescription 全链路；留空前台回退文章标题）
- [x] 富文本 HTML 清洗。（统一清洗器 `src/lib/admin/security/html-sanitizer.ts`（sanitize-html 白名单），8 个触点全覆盖：文章/公告 创建、编辑、发布闸门、预览；发布时正文再清洗，变化则同事务收敛写库，清洗后为空 422 拒发布；编辑器粘贴侧净化；历史 28 篇正文不批量重写、按标签集合回归通过）
- [x] 公告 CRUD、排序和发布状态。（默认排序 = 活跃最大 +1；`POST /bulletins/reorder` 批量上移/下移：单事务、逐行乐观锁、任一行冲突整体回滚；列表默认排序值升序）
- [x] 发布/撤回审计。（`article.{create,update,publish,archive,soft_delete,restore}`、`bulletin.{…+reorder}`；正文以摘要/长度/哈希入日志，同事务写入；403/409/422 不产生日志）

验收：/articles、/articles/[id]、/bulletin/[id] 回归 200；XSS payload 无法执行（`<script>`/`onclick`/`javascript:` 服务端剥离，预览即入库形态）。

Gates：lint / typecheck / build 通过；`npm run test:admin` 35 文件 558 用例全绿（`p6c-articles-api` 54、`p6c-bulletins-api` 40、`p6c-html-sanitizer` 41、`p6c-media-path` 10，真实 MySQL scratch 库 `facai8_p6c_test`；整改后复跑含 p6b 收紧断言仍全绿）。

迁移 0004：`articles.id`、`bulletins.id` 转 BIGINT UNSIGNED AUTO_INCREMENT（雪花历史 ID 原样保留，无重建无清空）；开发库 `facai8_admin` 已应用，`docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql` 同步。

RBAC：复用既有 `articles.*`/`bulletins.*` 权限码——editor 不可发布/删除/恢复（可排序，排序即 `*.update`），auditor 只读；API 层强制。

静态冻结：`src/lib/facai8/data/` 20 文件与 P6B 基线提交逐字节一致（`git hash-object` 全比对）；前台页直接 import 静态模块，草稿永不泄漏到公开页。

整改（验收反馈三问题，均已修复并补测试）：

- [x] 问题 01 · 管理员端 DOM XSS（P1 安全）。`RichTextEditor` 挂载时把详情接口返回的库内原始 `contentHtml` 直接写入 `contentEditable`——历史未清洗正文（`onclick=`、`<script>` 等）会在编辑器内即时执行。修复：详情/列表 DTO 新增 `editorHtml` 字段（`dto/article.ts`、`dto/bulletin.ts`，Repository `to*Dto` 读路径内存净化 `sanitizeRichHtml(row.contentHtml)`，幂等、不改库、不批量重写存量）；`ArticleEditor`/`BulletinEditor` 的 `toForm`、`initialHtml`、保存后回灌、发布收敛同步四处一律消费 `editorHtml`；`contentHtml` 仍原样透出（前台渲染/审计对照）。`RichTextEditor` Props 写明「只接受服务端 Sanitizer 产物」安全契约。
- [x] 问题 02 · 分类关联 TOCTOU（P1）。`createArticle` 的分类存在性检查在 `db.transaction` 之外，「检查通过 → 分类被并发软删除 → 照常插入」竞态（软删除不触发外键错误）；publish/restore 的分类检查是普通快照读。修复：`article-category-repository.ts` 新增 `lockArticleCategoryBriefForUpdate`（最小字段 + `SELECT ... FOR UPDATE`）；`assertCategoryUsable` 改为锁定读，create 的分类检查移入事务内，publish/restore 同改（要求分类 active 的发布闸门也在锁后判定）；锁序「先 articles 行后分类行」与既有约定一致，无反序死锁。测试：持锁事务实测阻塞并发 `UPDATE article_categories SET deleted_at`（锁释放前落地不可见）。
- [x] 问题 03 · 媒体路径策略过宽（P1）。旧 `mediaPathSchema` 放行任意 `/` 开头路径（含未知后缀、`..`、查询串），`isSafeMediaSrc` 放行任意 http(s) 外链。修复：新建唯一策略源 `src/lib/admin/validation/media-path.ts`（isomorphic，客户端可 import）——站内 = 根前缀白名单（`/uploads/ /sites/ /images/ /videos/ /media/`）+ 已知图片/视频后缀 + 禁 `\`/控制字符/查询串/hash/`.`与`..`段/相对路径；站外 = 显式开关 `ALLOW_EXTERNAL_MEDIA = true`（策略明示：兼容 1 条历史绝对 Logo 与正文粘贴外链，仍过 `checkHttpUrl` 硬校验、服务端零远端抓取、前台 CSP 兜底）；`checkHttpUrl` 收敛至该模块（默认 label「地址」保持 p6b 文案不变）。`link-schema.mediaPathSchema`、封面/头像 schema、`html-sanitizer.isSafeMediaSrc`、`RichTextEditor.looksLikeSafeMediaSrc` 全部委托。文件存在性刻意不校验（快照引用未落盘的 `/uploads/**`，存在性盘点属 P6D 素材接入范围）。

整改测试：`p6c-media-path.test.ts`（新增 10 用例）、`p6c-html-sanitizer.test.ts`（新增站内收紧用例）、`p6c-articles-api.test.ts`（新增 editorHtml 双字段/列表项、FOR UPDATE 阻塞并发软删除、封面 422 与历史形态放行 6 用例）、`p6c-bulletins-api.test.ts`（新增 editorHtml 2 用例）；既有 `p6b-links-schema.test.ts` 的 Logo 用例按新政策调整（裸 `/` 移入拒绝列表，新增站内未知后缀拒绝——原文件保留、其余断言不动）。

> 开发库遗留（供验收复核）：`facai8_admin` 保留走查记录 `P6C走查_UI新建文章`（id `112450241390841857`，published v6，曾删除+恢复）与 `P6C走查_UI新建公告`（id `92981247277666305`，published v5，排序至 sort=0，曾删除+恢复）；走查引导账号 `smokeadmin` 密码已重置为 `P6c-Sm0ke-2026!`（`must_change_password=0`）；RBAC 补齐了早于 P6A 的种子所缺的 4 条 `article_categories.*` 权限及 4 角色映射（`INSERT IGNORE` 幂等补齐，与 `scripts/admin/seed-rbac.ts` 标准集一致）。

## P6D：广告、线路、设置

- [x] 广告位置、素材、目标 URL、时间窗口、排序、启停。（位置白名单当前仅 `home`（服务端 allowlist，新增位置只需扩枚举）；`/admin/ads` 列表 + 弹窗编辑器 `AdFormDialog`（A 基本信息 / B 投放设置 / C 状态三节）；`targetUrl` 完整 http(s) 硬校验（复用 `checkHttpUrl`），服务端**从不访问**目标地址（无 SSRF），预览只打开站内图片；`startsAt<endsAt` 成对校验，留空=立即生效/不限结束；状态机 draft→active、active↔disabled、expired→active/disabled（同状态 422），`effectiveStatus`（active+时间窗推导）仅展示不落库；新建恒为草稿；`POST /ads/reorder` 同位置作用域相邻交换，跨位置 409 `REORDER_SCOPE_MISMATCH`，逐行乐观锁单事务整批回滚）
- [x] 线路名称、URL、排序、启停。（`/admin/lines` + `LineFormDialog`；新建恒为**停用**；状态只走 `PATCH /lines/[id]/status`（body 仅 `{status,version}`）；reorder 全局作用域（body 拒绝 position 字段）；URL 保存时仅格式校验、**不做可达性探测**（探测属前台既有能力））
- [x] 站点名称、描述、Logo、favicon、页脚设置。（`/admin/settings` 四组卡片（基础信息/品牌/页脚/广告）+ 每组独立「保存本组」+「恢复默认值」（本地回填 SETTING_DEFAULTS=前台 SITE_INFO 口径，保存后生效）；无权限角色只读）
- [x] 白名单设置键，禁止任意环境配置写入。（`GET/PATCH /settings` 仅允许 6 键：`site_name`、`site_description`、`site_logo`、`site_favicon`、`footer_text`、`ads_random`；未知键 422 `SETTINGS_UNKNOWN_KEY`；PATCH `{items:[{key,value,version}]}` 单事务全有或全无、逐行 `FOR UPDATE`（键名排序锁序）、version+1、同事务审计 `setting.update`）
- [x] 图片路径存在性校验。（统一策略源 P6C 的 `media-path.ts` 之上新增服务端存在性解析 `src/lib/admin/security/media-file.ts`（server-only）：站内路径映射到 `public/` 磁盘校验，legacy `/uploads/...` 按 basename 映射 `public/sites/facai8/images/`（镜像前台冻结 asset() 口径）；广告 imagePath、settings logo/favicon 保存前均校验，缺文件 422（settings 为 `SETTINGS_MEDIA_MISSING`）；禁 SVG/HTML/外链）

验收：首页广告、/lines、页面 metadata 和站点品牌字段回归 200（`CONTENT_SOURCE` 仍 static，前台读冻结快照，9 条前台路由全 200）；浏览器走查（smokeadmin/super_admin）覆盖广告 新建→启用→上移/下移→删除→回收站→恢复（状态与排序保留）、线路 新建默认停用→启用→上移→停用→删除→恢复、设置 逐组保存 v 递增、缺文件 422 内联报错、409 静默回取版本保留编辑、恢复默认值填入+提示。

Gates：lint / typecheck / build 通过；`npm run test:admin` 39 文件 684 用例全绿（新增 `p6d-ads-api`、`p6d-lines-api`、`p6d-settings-api`、`p6d-media-path` 与 `p6d-harness`，真实 MySQL scratch 库 `facai8_p6d_test`；无删除/放宽既有用例）。

迁移 0005：`ads.id`、`site_lines.id` 转 BIGINT UNSIGNED AUTO_INCREMENT（雪花/自增历史 ID 原样保留，DTO 一律字符串 id）；`site_settings.version` 乐观锁列已就位（懒初始化幂等 ODKU no-op，首次读取建行 version=1）；开发库 `facai8_admin` 已应用，`docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql` 同步。

RBAC：复用 seed 既有 `ads.*`、`lines.*`、`settings.view`/`settings.update` 权限码——API 层强制，UI 按权限标志隐藏动作按钮（auditor 只读；editor 无 delete/restore 时列表不显示）。

静态冻结：`src/lib/facai8/data/` 20 文件与基线 blob 逐字节一致（`git rev-parse HEAD:<path>` vs `git hash-object` 20/20 相同）；`src/lib/facai8`、`public` git diff 为空；设置媒体解析、图片预览的 legacy 路径映射仅为**后台 UI 展示**服务，不反写前台静态数据。

> 开发库遗留（供验收复核）：`facai8_admin` 保留走查记录 `P6D走查_UI新建广告`（active、sortOrder=14）与 `P6D走查_UI新建线路`（disabled、sortOrder=4）；`site_settings` 中 `footer_text` v3（默认值「搜你一切想搜」，曾外部改动+冲突回取）、`ads_random` v3（true）。开发环境注意：`.env` 未含 `ADMIN_CSRF_SECRET` 时 CSRF HMAC 密钥每进程随机（dev 回退），Turbopack 热重编译会导致刷新后写请求 403——本地走查需显式注入固定 dev 密钥。

## P7：仪表盘、审计、导入（已完成，2026-11-12）

- [x] 仪表盘仅展示真实统计（单条 `SELECT (subquery) as key` 聚合 COUNT，无 N+1、无虚构数字；每卡带口径标签；DB 不可用显示「数据库连接异常/统计暂不可用」，绝不显示 0；指标按会话权限过滤；「权限 46 项」为实时 COUNT 不再硬编码；最近导入按 id 倒序单行查询不再 count+offset）。
- [x] 审计日志只读筛选（GET /api/admin/v1/audit-logs + /admin/audit-logs 页；全部过滤参数 zod 校验、sortBy 白名单 createdAt|id（默认 createdAt DESC, id DESC）、pageSize∈{20,50,100}；操作人 leftJoin 已删除显示「已删除管理员」不丢行；IP VARBINARY(16) 以 SQL `hex()` 读出并解码 IPv4/IPv6/IPv4-mapped，NULL 显示「—」；不存在编辑/删除/清账入口）。
- [x] 写操作记录 actor/action/resource/before/after/requestId/IP（P3 writeAudit 契约延续；P6A–P6D 全部 CRUD 已接；P7 新增 import.execute 审计且成功审计在内容事务内——审计失败 → 内容回滚，杜绝误导性成功日志）。
- [x] 日志脱敏（统一 redactor 写入前 + 读取后双保险：递归对象/数组，深度 16 / 列表 200 / 字符串 8192 上限，循环引用与超限打标记，脱敏异常 fail-closed 隐藏原值；密钥键名 pin/otp/auth 精确匹配 + authorization/session/signature 子串；自由文本 `api_key="x"` / `key=value` 形态一并遮蔽；详情页纯 `<pre>` 展示，无 innerHTML）。
- [x] 导入预检、差异展示、确认导入和历史记录（复用 P4 核心 `static-import-core.ts` + 新差异引擎 `import-compare.ts`（13 表、missing/extra/changed/order_changed/relation_error 五类差异，列表上限 100 + truncated 标志）；预览零写入已测（runs/审计行数一字不变）；执行需预览回执 + 手输库名 + 命名锁；历史只读列表/详情/筛选/分页，CLI 行与已删发起人形态覆盖）。
- [x] 破坏性动作强制二次确认（执行导入：服务端 preview 回执 snapshotVersion+checksum 不可被客户端覆盖(409) → confirmDatabase 手输与服务端库名精确匹配(422) → 生产环境额外 confirmProduction 勾选 + ADMIN_IMPORT_ALLOW_PRODUCTION=1 环境变量双因子(409) → MySQL GET_LOCK `facai8_import_<db>` 跨进程互斥(409 IMPORT_LOCKED)）。

验收：48 测试文件 / 785 用例全绿（P7 新增 9 文件 101 用例，真实 MySQL scratch 库 `facai8_p7_test`；含 4182 行真实导入 → runs 行 started_by 为真实管理员 ID、重跑 no_op 引用 matched_run_id、GET_LOCK 占用 → 409 后锁即时释放）；lint/typecheck/build 全绿；浏览器走查 3 页零控制台错误（工作台真实统计+口径、操作日志筛选/详情脱敏 `<pre>`/`::1` IP 解码、数据导入预览差异明细/禁用执行/CLI 历史详情）；前台冻结：`src/lib/facai8/data/` git diff 为空，10 条前台路由 200。

## P8：前台数据源切换（已完成，2026-11-12；生产切换动作属 P9 发布）

### 切换前门槛
- [x] P4 导入一致性通过（对照库 `facai8_p8_test` 重放导入，checksum `251537562d…3e915f` 与快照一致）。
- [x] P6 内容管理 CRUD 通过（P6A–P6D 既有 684 用例在 P8 全程未删未放宽）。
- [x] MySQL Repository 与静态 Repository 的 DTO 形状一致（`p8-parity` 56 用例真实数据逐字段深比较）。
- [ ] 已完成数据库和静态文件备份（切换窗口内执行，见 `docs/P8_ROLLBACK_RUNBOOK.md` §1；静态侧本就零改动）。
- [ ] 已确认生产切换窗口（P9 发布时确认）。

### 顺序（全部完成，每组后跑全套门禁 + 双渲染对比）
1. [x] 首页和分类读取（ALL_MATCH 8/8）。
2. [x] 网址详情（ALL_MATCH 14/14）。
3. [x] 文章列表/详情和公告（ALL_MATCH 20/20）。
4. [x] 标签和线路（ALL_MATCH 21/21）。
5. [x] 广告与站点设置（ALL_MATCH 36/36）。

每组变更后做字段、顺序、分页、SEO、空态、404、媒体路径对比（最终固化为 39 路径双渲染回归集）。

### 验收
- [x] static 模式与切换前行为一致（20 个静态数据文件 SHA-256 冻结 20/20、受保护路径 git diff 为空、双渲染 static 侧即现行线上形状）。
- [x] mysql 模式页面行为与静态基线一致（同一构建双模起服，39 路径归一化 DOM 逐字节 ALL_MATCH 39/39）。
- [x] MySQL 不可用时显示明确 5xx/错误，不静默读取旧静态值（死库实况 E2E：11/11 路径 HTTP 500、响应无静态内容痕迹、`ContentSourceError` 固定消息含 32hex 请求编号并写服务端日志）。
- [x] 切回 static 可在配置变更和重启后恢复（同一构建仅改 `CONTENT_SOURCE` + 重启即恢复 static，双渲染 3111/3112 双模互证；操作步骤固化在 RUNBOOK §2）。
- [x] 原始快照未删除（`src/lib/facai8/data/` 原封不动，`scripts/p8-static-hash.mjs` 守卫）。

验收：52 测试文件 / 904 用例全绿（P2–P7 既有 785 用例未删未放宽；P8 新增 `p8-rules` 38、`p8-parity` 56、`p8-visibility` 17、`p8-content-error` 8 共 4 文件 119 用例，真实 MySQL 对照库）；lint/typecheck/build 全绿（前台全部路由动态 ƒ）；P8-7 去重以 `performance_schema` 采样取证（单请求 `site_settings` 恰 1 条 SELECT）；P8-8 浏览器实测 hydration 错误视图 + 请求编号↔日志 digest 关联。交付物：`docs/P8_FRONTEND_MIGRATION_REPORT.md`、`docs/P8_DATA_PARITY_REPORT.md`、`docs/P8_ROLLBACK_RUNBOOK.md`。生产未切换，默认仍 `CONTENT_SOURCE=static`。

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
