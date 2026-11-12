# 后台管理系统技术开发方案

> 项目：彩搜搜（ai-website-cloner-template）
> 文档版本：1.0
> 编制基线：仓库 master 分支当前代码
> 目标执行模型：本地 Qwen3.8-27B-4bit
> 本文只定义方案，不代表后台代码已经实现。

## 1. 建设目标与边界

### 1.1 建设目标

在不破坏现有 Next.js 前台、路由、样式、静态资源和采集快照的前提下，新增一个独立、可维护、可扩展的后台管理系统。后台用于管理已经采集到的站点内容和后续运营数据，并逐步让前台从静态快照切换到 MySQL 数据源。

核心原则：

1. **现有前台优先稳定**：不重写现有页面，不修改现有 URL 语义，不删除或覆盖 Mock 数据。
2. **快照只读保留**：当前 TypeScript 数据文件作为原始采集快照和回滚基线，后台不直接写入这些文件。
3. **渐进式切换**：先建库、导入和后台 CRUD，再通过数据访问层切换前台；默认仍使用 static 模式。
4. **职责分层**：页面、API、业务服务、数据仓储、数据库 schema 分层，避免在页面和 Route Handler 中直接拼 SQL。
5. **可验证交付**：每个阶段必须通过 lint、typecheck、build、数据库迁移验证和前台回归后才能进入下一阶段。
6. **安全默认开启**：后台账号、会话、权限、CSRF、审计、输入校验、HTML 清洗和备份必须纳入设计，不把现有 Mock 会员登录当作后台认证。

### 1.2 非目标

第一期不实现以下功能，除非后续明确确认：

- 不实现支付、充值、提现或第三方资金业务。
- 不实现真实会员中心、会员余额、收藏、评论、用户投稿审核等完整业务数据库。当前这些前台页面及接口存在 Mock/空数据行为，不能据此推断已经有会员数据表。
- 不自动抓取、探测或访问第三方站点。后台保存 URL 不代表需要服务端主动请求该 URL。
- 不把原站账号、密码、Cookie 或访问凭据迁移到新后台。
- 不直接把原始静态数据文件改造成数据库生成文件。
- 不在第一期引入微服务、独立 Express/Nest 服务、Redis、消息队列或复杂多租户架构。

## 2. 当前仓库基线（已检查）

### 2.1 技术栈与构建

| 项目 | 当前仓库事实 |
|---|---|
| 框架 | Next.js 16.3.5，App Router |
| UI | React 19.2.4、TypeScript strict |
| Node | package.json 要求 Node.js >=24 |
| 样式 | Tailwind CSS 4，项目已有站点专属 CSS |
| 生产输出 | next.config.ts 已配置 output: standalone |
| 包管理 | npm，仓库包含 package-lock.json |
| 当前测试脚本 | lint、typecheck、build、check |
| 数据库 | 当前 package.json 没有 MySQL 驱动或 ORM 依赖 |
| 部署 | 已有 Dockerfile 与 docker-compose.yml |

新增功能应继续运行在现有 Next.js Node.js Runtime 中，不另起一个 HTTP 服务。数据库访问代码必须声明为服务端代码，禁止进入 Client Component bundle。

### 2.2 已存在的前台页面路由

以下路由已经存在，新增后台时必须保护：

| 路由 | 当前用途 |
|---|---|
| / | 首页、分类区块和站点导航 |
| /category/[categoryId] | 分类下的网址列表 |
| /link/[id] | 网址详情 |
| /articles | 文章列表 |
| /articles/[id] | 文章详情 |
| /bulletin/[id] | 公告详情 |
| /search | 站内搜索 |
| /lines | 线路检测/线路信息 |
| /tag/[tagId] | 标签列表 |
| /about | 关于页面 |
| /agreement | 用户协议 |
| /disclaimer | 免责声明 |
| /privacy | 隐私政策 |
| /login、/register | 现有 Mock 会员认证页面 |
| /forgot-password | 现有 Mock 找回密码页面 |
| /profile | 会员资料页面 |
| /favorites | 收藏页面 |
| /my-posts | 我的发布页面 |
| /my-comments | 我的评论页面 |
| /submit-article | 投稿页面 |

以仓库当前路由文件为准。开始实施前，Agent 必须重新扫描 src/app，不得仅依赖本表。

现有 API 主要包含 src/app/api/auth 下的 Mock 认证接口。新增后台 API 使用独立命名空间，不复用现有认证接口。

### 2.3 当前静态采集数据

关键文件位于 src/lib/facai8/data/：

| 文件 | 当前用途/数据结构 |
|---|---|
| categories.ts | LINK_CATEGORIES，一级分类和 children 子分类 |
| links.ts | ALL_LINKS，网址记录，字段包括 id、categoryId、logoUrl、url、title、description、isGone、tagId |
| link-order.ts | CAT_ORDER，分类内链接顺序快照 |
| link-details.ts | LINK_DETAILS，网址详情补充信息，属于部分链接的可选数据 |
| link-mirrors.ts | LINK_MIRRORS，部分网址的备用链接 |
| tags.ts | TAGS，网址标签 |
| articles.ts | ALL_ARTICLES，文章正文、封面、分类、SEO、作者、浏览量和时间 |
| article-categories.ts | ARTICLE_CATEGORIES，文章分类 |
| bulletins.ts | BULLETINS，公告 |
| ads.ts | HOME_ADS，首页广告快照 |
| lines.ts | ALL_LINES，线路信息 |
| site-info.ts | SITE_INFO，站点名称、描述、Logo、favicon、页脚等 |
| icon-libraries.ts | ICON_LIBRARIES，图标字体库信息 |
| site-static.ts | 关于、协议、免责声明、隐私等静态页面内容 |
| popup.ts | 首页弹窗相关快照/配置（实施前需核对引用关系） |
| stats.ts、new-links.ts、recent-links.ts、new-articles.ts | 展示用统计或列表快照，实施前需核对它们与主数据的派生关系 |
| searchDescriptions.ts | SEARCH_DESCRIPTIONS，搜索结果摘要快照（源站搜索接口存档，25 键；P0 审计补录，此前本表遗漏） |

本仓库当前已检查到约 60 个一级网址分类、3791 条网址、28 篇文章、5 个文章分类、14 条首页广告、1 条公告、5 条线路和 5 个标签。数字是当前快照统计，不是永久不变的业务约束。link-details 只覆盖一部分网址，不能在导入时为没有详情的链接伪造详情记录。

**禁止事项：**
- 不删除 src/lib/facai8/data 下任何原始文件。
- 不把源站 17 位数字 ID 转为 JavaScript Number；必须始终以十进制字符串传递。
- 不把所有链接强制补成详情记录。
- 不丢失 CAT_ORDER 的排序结果。
- 不将图片路径中的原始 /uploads/... 误当成当前可直接访问的线上路径；必须遵循现有 asset() 资源映射规则或统一媒体映射。

### 2.4 当前认证现状与风险边界

现有 src/lib/facai8/auth.ts 和 auth-api.ts 是前台 Mock 会员会话实现，使用 facai8_session Cookie；其 Cookie 内容只是 Base64 编码，不能作为可信的管理员身份凭证。当前密码登录在未设置测试账号时有任意非空凭据放行的演示兜底。

因此：
- 新后台必须使用独立的 admin_users、admin_sessions 和 RBAC 表。
- 新 Cookie 使用独立名称，例如 facai8_admin_session。
- 后台绝不能调用 getSessionUser() 来判断管理员身份。
- 后台绝不能复用 SOURCE_TEST_USERNAME / SOURCE_TEST_PASSWORD 作为管理员账号。
- 不允许通过隐藏按钮、前端路由守卫或 Middleware 单独实现权限控制；每个服务端读写操作都必须检查权限。

## 3. 推荐技术方案

### 3.1 技术选型

| 层次 | 方案 | 原因 |
|---|---|---|
| Runtime | Node.js 24 LTS/当前项目要求版本 | 与 package.json 和 Dockerfile 基线一致 |
| Web 框架 | 现有 Next.js App Router | 复用当前路由、部署和组件体系 |
| UI | 现有 React、Tailwind、Base UI/shadcn 组件 | 不引入第二套 UI 体系 |
| 数据库 | MySQL 8.0.36+，优先 MySQL 8.4 LTS | 稳定、事务、JSON、外键和成熟备份工具 |
| Driver | mysql2 | Node.js MySQL 连接池 |
| ORM | Drizzle ORM + drizzle-kit | TypeScript schema、类型推导、可审查 SQL migration |
| 参数校验 | Zod | API 输入和环境变量校验 |
| 密码哈希 | argon2，Argon2id | 管理员密码使用专用强哈希 |
| Session | 数据库服务端 Session + crypto.randomBytes | 可撤销、可审计，不依赖 JWT 长期有效 |
| HTML 清洗 | sanitize-html | 文章、公告和页面富文本入库前清洗 |
| 测试 | Vitest + Playwright | 单元/集成和浏览器端回归 |
| 上传 | 本地持久化目录 + 媒体服务路由；后续可替换 S3 兼容存储 | 不把二进制文件存进 MySQL |

版本要求：实施时根据 Node 24、Next 16 和当前 lockfile 选择兼容版本并固定版本号。不得随意执行无约束的全量依赖升级。

### 3.2 为什么不单独建立 Express/Nest 服务

当前前台已经是 Next.js App Router。后台只是同一站点的运营管理能力，继续使用 Next.js Route Handlers 可以：
- 减少一套服务、端口、部署和监控；
- 复用同一域名、Cookie、HTTPS 和静态资源；
- 让 Qwen 只需维护一个 TypeScript 工程；
- 将来业务复杂到需要独立服务时，再抽离 service/repository 层。

数据库连接、密码哈希、文件操作必须运行在 Node.js Runtime，禁止 Edge Runtime。

## 4. 总体架构

建议采用以下分层：

    Browser
      ├── 现有前台路由（保持不变）
      └── /admin 后台页面
              │
              ▼
       Next.js Server Components
       Next.js Route Handlers
              │
              ▼
       Auth / RBAC / Validation
              │
              ▼
       Application Services
              │
              ▼
       Repository Interfaces
          ├── StaticSnapshotRepository（只读）
          └── MySqlRepository（可写）
              │
              ▼
          MySQL 8.x

### 4.1 代码目录建议

这是目标目录，不代表当前已经存在。Agent 应先检查路径，再逐步创建。

    src/
      app/
        admin/
          login/page.tsx
          layout.tsx
          page.tsx
          categories/page.tsx
          links/page.tsx
          articles/page.tsx
          article-categories/page.tsx
          bulletins/page.tsx
          ads/page.tsx
          tags/page.tsx
          lines/page.tsx
          settings/page.tsx
          administrators/page.tsx
          audit-logs/page.tsx
          imports/page.tsx
        api/
          admin/
            v1/
              auth/
              categories/
              links/
              articles/
              article-categories/
              bulletins/
              ads/
              tags/
              lines/
              settings/
              administrators/
              audit-logs/
              imports/
      lib/
        admin/
          auth/
          permissions/
          validation/
          services/
          repositories/
          dto/
        db/
          client.ts
          schema/
          migrations/
        facai8/
          content/
            source.ts
            static-repository.ts
            mysql-repository.ts
      components/
        admin/
          layout/
          tables/
          forms/
          editors/
          feedback/
      scripts/
        admin/
          bootstrap-admin.ts
          import-static-snapshot.ts
          verify-import.ts
      drizzle.config.ts

    drizzle/
      migrations/

实际目录可根据现有代码风格微调，但不得把数据库访问逻辑散落在页面文件中。

## 5. 前台静态数据与 MySQL 的边界

### 5.1 双数据源策略

新增环境变量：

    CONTENT_SOURCE=static

允许值：
- static：默认值。前台继续读取原有 TypeScript 静态数据。
- mysql：数据库完成迁移和快照导入后，前台通过 Repository 读取 MySQL。

重要规则：
1. 默认必须为 static，确保未配置 MySQL 时现有网站继续可运行。
2. 管理后台的数据写入 MySQL，不修改静态快照。
3. 数据库导入前，不允许把 CONTENT_SOURCE 改成 mysql。
4. 切换到 mysql 前，必须完成记录数、ID、分类关联、图片路径和排序一致性验证。
5. mysql 模式下发生数据库异常必须明确报错并记录日志，不能静默回退到旧静态数据，否则管理员会误以为保存成功。
6. 回滚时只需将 CONTENT_SOURCE 改回 static 并重启服务；静态快照必须始终存在。
7. 允许管理后台先独立运行和管理 MySQL，而前台仍保持 static 模式；这期间后台修改不会立即反映到前台，界面和文档必须明确提示当前数据源。

### 5.2 读取层设计

先定义前台需要的稳定接口，例如：
- getHomeCategories()
- getLinksByCategory(categoryId)
- getLinkById(id)
- getLinkDetail(id)
- getArticleCategories()
- getArticles(query)
- getArticleById(id)
- getBulletins()
- getAds(position)
- getTags()
- getLines()
- getSiteSettings()

由 source.ts 根据 CONTENT_SOURCE 选择 StaticSnapshotRepository 或 MySqlRepository。页面只调用读取接口，不直接 import MySQL client。

第一阶段不改现有页面读取方式；等数据库导入和 Repository 测试通过后，再逐个迁移页面。每迁移一组页面，立即执行该组回归。

### 5.3 导入规则

建立一次性静态快照导入脚本：
- 从原始 TypeScript 数据文件读取数据。
- dry-run 只做统计、校验和冲突报告，不写入数据库。
- 正式导入在事务中执行，或按模块分批执行并写入 import_runs。
- 保留源站原 ID，写入 MySQL BIGINT UNSIGNED；Node 端始终将 ID 当字符串。
- 分类先导入，标签/文章分类其次，链接和文章随后，详情、备用链接、广告、公告等最后。
- 先校验父子分类、链接分类、tagId、文章分类和镜像 linkId 的外键关系。
- CAT_ORDER 转换成 links.sort_order；未出现在 CAT_ORDER 的链接按静态原始顺序追加。
- 不为缺失的 LINK_DETAILS 生成空详情行。
- 对日期、HTML、空字符串、null、0/1、路径和 URL 做无损映射。
- 导入记录保存快照版本、校验摘要、记录数、成功/失败数和执行人。
- 重复执行默认拒绝；不得用 INSERT ... ON DUPLICATE KEY UPDATE 无条件覆盖后台已经修改的数据。
- 需要重新导入时，先数据库备份，再使用显式确认参数；提供差异报告，不提供一键覆盖式重置。

## 6. 后台功能范围与交互

### 6.1 第一阶段模块

| 模块 | 核心能力 | 说明 |
|---|---|---|
| 仪表盘 | 数据总量、最近修改、导入状态、系统状态 | 不虚构 PV/UV；当前没有真实访问分析数据 |
| 网址分类 | 一级/二级分类、新增、编辑、排序、启停 | 删除前检查子分类和关联链接 |
| 网址管理 | 搜索、筛选、分页、新增、编辑、上下架、软删除 | 支持批量启停，不默认批量物理删除 |
| 网址详情 | 详情补充字段、备用链接 | 详情是可选一对一记录 |
| 文章分类 | 分类 CRUD、排序、启停 | 与网址分类分表 |
| 文章管理 | 编辑、预览、SEO、发布/草稿/归档 | 富文本必须清洗 |
| 公告管理 | CRUD、排序、发布状态 | 保留原始公告 |
| 广告管理 | 标题、图片、目标 URL、位置、排序、投放时间、启停 | 首页广告 position=home |
| 标签管理 | 名称、图标、颜色、启停 | 与 links.tag_id 关联 |
| 线路管理 | 名称、URL、排序、启停 | 不在保存时主动请求目标 URL |
| 站点设置 | 名称、描述、Logo、favicon、页脚等 | 使用白名单字段，不允许任意改环境变量 |
| 管理员与角色 | 管理员、角色、权限 | 仅 super_admin 可管理 |
| 操作日志 | 操作人、动作、对象、前后值、时间、IP | 写操作必须记录 |
| 静态数据导入 | 预览、校验、正式导入、历史记录 | 默认只允许首次导入 |

### 6.2 后台交互原则

- 列表页统一提供关键词、状态、分类筛选，分页和每页数量。
- 默认每页 20 条，可选 20/50/100；服务端强制 pageSize 最大 100。
- 表格操作使用明确的编辑、启用/停用、删除按钮；危险操作必须二次确认。
- 新增/编辑使用同一表单组件，前后端共享 Zod schema。
- 表单保存显示字段级错误，避免只弹“操作失败”。
- 关键操作完成后显示成功提示并刷新对应列表。
- 排序操作需支持保存、取消和冲突提示。
- 长文本、HTML 和图片编辑提供预览。
- 所有空状态、加载状态、权限不足、服务异常都需要明确 UI。
- 管理后台使用独立布局，不复用 SiteFrame 的前台导航布局。
- 桌面端优先，平板可用；小屏至少保证表单和列表不溢出。

## 7. 数据库设计概览

完整 DDL 见 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql。

主要表：

### 7.1 管理员与权限

- admin_users：管理员账号和密码哈希。
- admin_roles：角色。
- admin_permissions：权限字典。
- admin_user_roles：管理员角色关联。
- admin_role_permissions：角色权限关联。
- admin_sessions：服务端 Session，只保存 token SHA-256 摘要。
- admin_login_attempts：登录失败计数和临时锁定。

初始角色建议：
- super_admin：所有权限，唯一可创建其他管理员和分配角色。
- content_admin：分类、网址、文章、公告、广告、标签和线路内容管理。
- content_editor：内容创建和编辑，不具备管理员管理、设置和导入权限。
- auditor：只读仪表盘和审计日志。

权限必须细化到资源与动作，例如 links.read、links.create、links.update、links.publish、links.delete。不能仅依赖角色名称判断。

### 7.2 内容数据

- link_categories：网址分类，parent_id 表示二级分类归属。
- article_categories：文章分类。
- site_tags：标签。
- site_links：网址主表。
- site_link_details：网址详情补充字段。
- site_link_mirrors：备用链接。
- articles：文章。
- bulletins：公告。
- ads：广告。（P6D：migration 0005 将 `id` 转 BIGINT UNSIGNED AUTO_INCREMENT，历史 ID 原样保留，DTO id 为字符串）
- site_lines：线路。（P6D：同上，`id` 自增化）
- icon_libraries：图标字体库元数据。
- site_pages：可选的关于/协议/免责声明/隐私页面内容管理。
- site_settings：站点键值设置。（P6D：`version` 乐观锁列启用，写入仅允许 6 键白名单）
- media_assets：上传文件元数据。
- admin_audit_logs：操作审计。
- admin_import_runs：快照导入记录。

### 7.3 数据库约束

- 所有表使用 InnoDB、utf8mb4。
- 主要 ID 使用 BIGINT UNSIGNED，保留原始数字 ID。
- mysql2 配置 supportBigNumbers=true、bigNumberStrings=true；DTO 中 ID 必须是 string。
- 所有外键列建立索引。
- 列表查询使用组合索引，例如 status + category_id + sort_order、status + created_at。
- 文章和公告正文使用 LONGTEXT；站点设置使用 JSON。
- 管理数据默认软删除，字段 deleted_at；仅在确实无关联且经过确认时物理删除。
- 关键记录包含 created_at、updated_at；需要并发保护的表包含 version。
- 使用 DATETIME 并在应用层统一时区策略；导入的原始时间字符串必须先确认来源时区再转换，禁止无依据偏移。
- 外键删除默认 RESTRICT；仅管理员会话等可安全级联的数据允许 CASCADE。

## 8. API 设计

所有后台 API 使用 /api/admin/v1 前缀，并且每个 Handler 都必须：
1. 校验 HTTP method 和 Content-Type。
2. 读取当前管理员 Session。
3. 校验对应 permission。
4. 校验 Origin/CSRF。
5. 使用 Zod 校验参数。
6. 调用 Service。
7. 返回统一响应并记录 requestId。
8. 对写操作写审计日志。

统一成功响应：

    {
      "success": true,
      "data": {},
      "meta": {
        "page": 1,
        "pageSize": 20,
        "total": 0
      },
      "requestId": "..."
    }

统一错误响应：

    {
      "success": false,
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "请求参数不正确",
        "fields": {}
      },
      "requestId": "..."
    }

建议状态码：
- 200：读取/更新成功
- 200：读取/更新/创建成功（全站实现均用 200 + DTO，未使用 201；P6D 沿用）
- 204：无响应体删除/注销成功
- 400：参数错误
- 401：未登录
- 403：无权限或 CSRF 校验失败
- 404：资源不存在
- 409：版本冲突、重复导入或唯一约束冲突
- 422：业务规则不满足
- 429：登录限流
- 500：服务端错误，不向客户端暴露 SQL、堆栈和密钥

主要端点：

| 方法 | 路径 | 权限/用途 |
|---|---|---|
| POST | /api/admin/v1/auth/login | 管理员登录 |
| POST | /api/admin/v1/auth/logout | 注销当前 Session |
| GET | /api/admin/v1/auth/session | 当前管理员和权限 |
| GET/POST | /api/admin/v1/categories | 网址分类列表/新增 |
| PATCH/DELETE | /api/admin/v1/categories/[id] | 分类修改/软删除 |
| GET/POST | /api/admin/v1/links | 网址列表/新增 |
| GET/PATCH/DELETE | /api/admin/v1/links/[id] | 网址详情/更新/软删除 |
| GET/POST | /api/admin/v1/articles | 文章列表/新增 |
| GET/PATCH/DELETE | /api/admin/v1/articles/[id] | 文章修改/软删除 |
| GET/POST | /api/admin/v1/article-categories | 文章分类 |
| GET/POST | /api/admin/v1/bulletins | 公告 |
| GET/POST | /api/admin/v1/ads | 广告（P6D 已实现：GET 列表支持 position/status/includeDeleted/关键词，POST 新建恒为草稿） |
| GET/PATCH/DELETE | /api/admin/v1/ads/[id] | 广告详情/更新（乐观锁）/软删除（`?version=`）（P6D） |
| PATCH | /api/admin/v1/ads/[id]/status | 广告启停 draft→active、active↔disabled、expired→active/disabled（P6D） |
| POST | /api/admin/v1/ads/[id]/restore | 广告恢复（保留原状态与排序）（P6D） |
| POST | /api/admin/v1/ads/reorder | 广告排序（同 position 作用域，跨位置 409 REORDER_SCOPE_MISMATCH）（P6D） |
| GET/POST | /api/admin/v1/tags | 标签 |
| GET/POST | /api/admin/v1/lines | 线路（P6D 已实现：POST 新建恒为停用） |
| GET/PATCH/DELETE | /api/admin/v1/lines/[id] | 线路详情/更新（不含 status）/软删除（P6D） |
| PATCH | /api/admin/v1/lines/[id]/status | 线路启停 active↔disabled（状态唯一入口）（P6D） |
| POST | /api/admin/v1/lines/[id]/restore | 线路恢复（保留原状态与排序）（P6D） |
| POST | /api/admin/v1/lines/reorder | 线路排序（全局作用域，body 拒绝 position）（P6D） |
| GET/PATCH | /api/admin/v1/settings | 站点设置（P6D 已实现：GET `{settings:{key:{value,version}}}`；PATCH `{items:[{key,value,version}]}` 单事务全有或全无） |
| GET | /api/admin/v1/audit-logs | 审计查询 |
| POST | /api/admin/v1/imports/preview | 导入预检 |
| POST | /api/admin/v1/imports | 执行导入 |
| GET | /api/admin/v1/imports/[id] | 导入状态 |

分页参数：
- page：从 1 开始。
- pageSize：默认 20，最大 100。
- q：关键词。
- status：允许值由具体资源 schema 定义。
- categoryId：字符串形式的 BIGINT ID。
- sortBy：必须由服务端 allowlist 控制。
- sortOrder：asc 或 desc。

禁止将用户传入的 sortBy 直接拼入 SQL 标识符；所有 SQL 值必须参数化。

## 9. 核心业务规则

### 9.1 分类

- 网址分类最多两级，与当前 LINK_CATEGORIES 结构一致。
- 二级分类必须关联有效一级分类。
- 一级分类不能删除仍有子分类的节点。
- 分类存在关联网址时，默认停用或软删除，不做物理删除。
- 分类 ID 必须是数字字符串，以兼容现有 /category/[categoryId] 页面 numeric 判断。
- 排序使用整数 sort_order；相同排序值按 ID 稳定排序。

### 9.2 网址

- url 只允许 http 或 https。
- 标题必填，长度限制明确。
- logo_path 允许站内已存在资源路径或受控媒体路径；不允许任意本地文件系统路径。
- is_gone 与 status 分开保存：is_gone 表示快照中的失效标记，status 表示运营发布状态。
- 删除采用 deleted_at 软删除。
- tag_id 和 category_id 必须存在且状态有效。
- 详情和备用链接均为可选子资源。
- 网址列表支持标题、URL、描述关键词、分类、标签、状态筛选。

### 9.3 文章与公告

- HTML 在服务端清洗后存储。
- 禁止 script、iframe、事件属性、javascript: URL、危险 SVG 和未知嵌入标签。
- 图片路径必须使用受控媒体服务或已知静态路径。
- 草稿不应出现在公开列表和搜索结果。
- 发布/撤回动作必须写审计日志。
- 文章浏览量只允许服务端受控递增，不接受客户端任意写入。

### 9.4 广告（P6D 已实施）

- 保存位置、标题、图片、目标 URL、排序、状态、开始和结束时间。
- 位置 allowlist：当前仅 `home`（首页）；服务端枚举校验，未知位置 422。
- DB 状态机（`status` 列）：`draft`/`active`/`disabled`/`expired` 四态——新建恒为 `draft`；启停只走 `PATCH [id]/status`：draft→active、active↔disabled、expired→active/disabled，同状态请求 422。
- `effectiveStatus` 为 DTO 只读推导字段（status=active 且落在 startsAt/endsAt 时间窗内才为 active，到期 active 展示 expired），不落库、不参与写校验。
- 投放时间：`startsAt < endsAt` 成对校验；留空分别表示立即生效（启用后）与不限结束。
- 图片路径：站内路径（`/` 开头），复用统一媒体策略（根前缀白名单 + 已知图片后缀 + 禁 SVG/HTML/查询串/外链）且**服务端做磁盘存在性校验**（`src/lib/admin/security/media-file.ts`，server-only）；legacy `/uploads/...` 按 basename 映射 `public/sites/facai8/images/`（镜像前台冻结 asset() 口径）；缺文件 422。
- 不在管理端预览时自动访问广告目标地址：`targetUrl` 仅做完整 http(s) 格式硬校验（禁 `javascript:`/`data:` 等），服务端零远端抓取（无 SSRF）；UI 预览只打开站内图片。
- 排序：`POST /ads/reorder` 限定同 position 作用域，跨位置混批 409 `REORDER_SCOPE_MISMATCH`；逐行 version 乐观锁，单事务整批回滚。
- 删除/恢复：`deleted_at` 软删除；恢复保留原状态、排期与排序值。
- 前台读取时按 position、status、时间窗口和 sort_order 过滤（P8 前前台仍读静态快照）。
- 广告的合法性、素材授权和展示地区限制由运营方确认。

### 9.5 线路（P6D 已实施）

- 字段：name、url、status、sort_order、version、deleted_at。
- 新建恒为 `disabled`（防止未经核验的线路直接对外）。
- 状态只走 `PATCH /lines/[id]/status`（active↔disabled）；通用 PATCH 不接受 status 字段。
- URL 仅格式校验（完整 http(s)，复用 checkHttpUrl），保存时**不做可达性探测**——可达性检测属前台既有能力。
- 排序为全局作用域（无 position 维度）；reorder body 出现 position 字段即 422。
- 软删除/恢复保留原状态与 sortOrder；回收站 = `includeDeleted=true` 筛选。

### 9.6 站点设置（P6D 已实施）

- 键白名单（6 个）：`site_name`、`site_description`、`site_logo`、`site_favicon`、`footer_text`、`ads_random`；未知键 422 `SETTINGS_UNKNOWN_KEY`，禁止任意键/环境配置写入。
- 值按类型校验：文本长度限制、媒体键走统一媒体策略 + 磁盘存在性（缺文件 422 `SETTINGS_MEDIA_MISSING`）、`ads_random` 仅布尔。
- `GET /settings` 返回 `{settings:{key:{value,version}}}`；行缺失时懒初始化（幂等 ODKU no-op，version=1）。
- `PATCH /settings`：`{items:[{key,value,version}]}` 单事务全有或全无——按 key 排序后逐行 `FOR UPDATE` 锁行防死锁，version 不符 409（消息与全站乐观锁文案一致），成功逐键 version+1，同事务写 `setting.update` 审计。
- 历史遗留双编码 JSON 值读取时仅当再解析结果为 string 才解包；写回一律干净 JSON。
- 媒体键（logo/favicon）UI 提供站内缩略预览（legacy `/uploads/` 路径映射口径与广告一致）。

## 10. 事务、并发与缓存

- 多表写操作必须在同一数据库事务中完成，例如创建文章并写入关联媒体。
- 删除分类前先检查关联数据，事务内再次检查，避免竞态。
- 批量操作限制最多 100 条，使用事务并逐条记录结果。
- 可编辑表使用 version 乐观锁；更新语句带 WHERE id=? AND version=?，影响行数为 0 时返回 409。
- 写入后只对受影响的公开路径调用 revalidatePath；不要无差别清空全站缓存。
- 管理列表和管理详情默认动态读取，不缓存用户权限和 Session。
- 公开内容读取可使用 Next.js revalidate 策略，但必须在数据源切换后明确失效策略。
- 对 MySQL 故障不得返回静态旧值伪装成功。

## 11. 部署与运行

环境变量示例：

    NODE_ENV=production
    CONTENT_SOURCE=static
    DB_HOST=127.0.0.1
    DB_PORT=3306
    DB_NAME=facai8_admin
    DB_USER=facai8_app
    DB_PASSWORD=由部署环境注入
    DB_POOL_SIZE=10
    ADMIN_SESSION_TTL_HOURS=12
    ADMIN_BOOTSTRAP_USERNAME=首次初始化使用
    ADMIN_BOOTSTRAP_PASSWORD=首次初始化使用
    UPLOAD_DIR=/data/facai8/uploads

要求：
- 环境变量只放在服务器 .env.local 或 Secret Manager，不提交 Git。
- 数据库用户只授予目标库所需权限，不使用 root 连接应用。
- MySQL 不直接暴露公网；应用通过私网/本机连接。
- Docker 使用独立持久卷保存 MySQL 数据和上传文件。
- 上传目录必须在容器重建后保留。
- 生产端口由 Nginx 反向代理；应用容器只绑定内网或 127.0.0.1。
- 迁移在发布流程中显式执行，不允许每次应用启动时自动执行破坏性迁移。
- 配置健康检查：应用健康检查和数据库连接检查分开。
- 备份至少包括 MySQL dump 和上传目录；定期演练恢复。

## 12. 交付验收标准

后台首期交付必须满足：
- /admin/login 可登录，未登录访问 /admin 自动跳转。
- 管理员角色和权限在服务端强制校验。
- 网址分类、网址、文章、文章分类、公告、广告、标签、线路和站点设置可按权限管理。
- 所有列表有分页、筛选、空状态和错误状态。
- 重要写操作有事务和审计记录。
- 原有静态数据文件未被覆盖或删除。
- CONTENT_SOURCE=static 时所有前台页面与改造前保持一致。
- MySQL 导入后记录数、ID、分类关系、链接排序和静态资源引用通过校验。
- CONTENT_SOURCE=mysql 时前台首页、分类、详情、文章、公告、标签和线路路由通过回归。
- 登录、注销、Session 过期、权限拒绝、CSRF、限流和 XSS 测试通过。
- npm run lint、npm run typecheck、npm run build 全部通过。
- Docker 构建、容器重启、数据库备份和恢复演练通过。

## 13. 关键决策待确认

在正式切换生产数据源前，项目负责人需要确认：
1. MySQL 部署位置：与 Next.js 同机 Docker，还是独立 MySQL 主机。
2. 后台是否只允许指定 IP/VPN 访问，还是公网域名 + MFA。
3. 首期是否需要图片上传；建议先复用现有图片，再实现持久化上传。
4. 是否需要运营人员多角色协作；如暂时只有一个管理员，仍保留 RBAC 结构但先只启用 super_admin。
5. 是否要管理关于、用户协议、免责声明、隐私页面；建议放第二期。
6. 是否要建立真正的会员、评论、收藏和投稿审核系统；这属于独立业务，不应混入第一期静态内容管理。

---
**实施入口：** 阅读 docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md，再按 docs/skills/admin-system-development/SKILL.md 的阶段执行。数据库 DDL 以 docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql 为准；安全和测试以 docs/ADMIN_SYSTEM_SECURITY_AND_TESTING.md 为准。
