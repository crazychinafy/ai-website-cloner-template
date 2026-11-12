# P9 部署前审计（P9-0 Pre-Deployment Audit）

审计日期：2026-11-12　基线：`bcd84aa`（分支 `feat/p9-security-deploy-ops`，P8 修复已验收）

> 本阶段只审计不改代码。证据均来自文档、实际代码阅读与已归档测试记录。

---

## 一、输入文档清单（11 项）

| # | 文档 | 状态 |
|---|---|---|
| 1 | docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md | ✅ 已读（P0–P8 全计划 + 验收史） |
| 2 | docs/ADMIN_SYSTEM_SECURITY_AND_TESTING.md | ✅ 已读（§17 P8/P1/P2 修复记录、测试矩阵） |
| 3 | docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql | ✅ 已读（26 表：23 业务 + 3 Drizzle 内部表，全 InnoDB/utf8mb4） |
| 4 | docs/P8_FRONTEND_MIGRATION_REPORT.md | ✅ 已读 |
| 5 | docs/P8_DATA_PARITY_REPORT.md | ✅ 已读 |
| 6 | docs/P8_ROLLBACK_RUNBOOK.md | ✅ 已读（§2 即 static 回退步骤） |
| 7 | README.md | ✅ 已读（含 Docker/备份/env 说明） |
| 8 | .env.example | ✅ 已读（13 个变量） |
| 9 | docker-compose.yml | ✅ 已读 |
| 10 | Dockerfile | ✅ 已读 |
| 11 | nginx 配置 | ⚠️ **不存在**（`nginx/` 目录、`*.conf` 均无）——P9-5 需新建模板，不伪造 |

## 二、代码审计范围

实际阅读：`middleware.ts`、`src/lib/admin/{session,auth,csrf,rbac,rate-limit,validation,env,audit,import-validation,connection,pool,import-runner,services/*}.ts`、`src/lib/facai8/{types,types-admin,content/*}.ts`、`src/app/api/admin/**` 全部 route handler、`src/app/admin/**` 页面、`scripts/admin/{migrate,bootstrap-admin,db-query,db-tool,export-schema,import-snapshot,verify-static-import}.ts`、Dockerfile、compose、README、.env.example、drizzle/0000–0007、package.json scripts。

---

## 三、已通过（有代码与测试证据）

### A. 认证与会话
1. **middleware 全站后台守卫**：`/admin`（除 `/admin/login`）无有效会话 cookie → 307 `/admin/login`；API 请求 → **401 JSON**；matcher 明确排除 `_next/static|_next/image|favicon.ico|sites|img|fonts|uploads`（前台静态资源不被劫持）。
2. **会话安全模型**：opaque token（32B 随机）、**SHA-256 哈希落库**（不存明文）、`token_version` 身份版本（角色变更/禁用/软删/改密即时撤销全部会话）、httpOnly + `Secure`(生产) + SameSite=Lax + path=/admin、DB `expires_at` 与行内 `expiresAt` 双校验、会话 8h 滑动续期、退出即时删除、单账号最多 20 会话（LRU 淘汰）、**登录成功/失败都轮换会话**（防固定）。
3. **前后台 cookie 名互斥**：前台 `facai8_user`（path=/）与后台 `facai8_admin_session`（path=/admin）名称不同，前台 cookie 永远不会被浏览器带入 `/admin` 以外的后台语义冲突；伪造前台 cookie 名/值在后台一律 401（session-auth 测试）。

### B. RBAC
4. 三层执行：middleware 粗粒度（`admin.access`）→ API 每 handler 显式 `requireAdminPermission`（**无全局默认放行**）→ UI `hasPermission` 仅用于显示。审计确认 **65 个 API handler 全部**有认证调用（`requireAdmin` 37 + `requireAdminSession` 4 处自带权限/登录语义 + auth 端点 `requireAdminSession` 2 处为登录态专用）。
5. 4 角色种子（super_admin 全部 / content_admin 56 / content_editor 32 / auditor 只读），`*` 通配 + `模块.动作` 精确匹配，未知模块 fail-closed；角色变更即时生效（version 撤销）——12 个 RBAC 测试覆盖。

### C. CSRF / Origin / 会话固定
6. mutation 校验 `x-csrf-token` == 会话内 token（timingSafeEqual）；`Origin` 存在时必须精确等于 `APP_URL`（含协议+端口）；**Origin 缺失不再被当作通过**（2026-11-12 安全评审修复）；GET 无 CSRF 要求——5+5 测试。

### D. 限流
7. 登录限流：**用户名单维度 5 次/15min + IP 维度 20 次/15min**（key 存 SHA-256，不泄漏 IP 明文）、锁定剩余 429、成功清零、进程内 fail-closed（Map 异常也拒绝）。

### E. 输入与内容安全
8. **SQL 注入**：全链路 Drizzle 参数化；排序列经 `sortColumn` 映射表（不拼列名）；LIKE 通配转义；原生 SQL 仅出现在白名单表名/绑定参数场景（import-runner）——13 个 mysql 方言注入探针（含 `CHAR(92)` 反斜杠技巧）+ login 方言探针全绿。
9. **XSS/URL 白名单**：`sanitizeInput`（控制字符剥离、20 万字符钳制、HTML 标签剥离）；`sanitizeMediaPath` 拒绝 `javascript:`/`data:`/`file:`/vbscript/未知 scheme/绝对 URL/控制字符/反斜杠；`isSafePublicMediaPath` 限定 `/uploads/`、`/sites/facai8/img/`、`/img/`、`/fonts/`，**拒绝 `..` 与 `//`**（IDOR/路径穿越）；HTML 正文清洗：标签 allowlist（白名单外整段删除其内容）+ 属性值内 scheme 检查 + `<script><style>` 内容删除——**浏览器 DOM 层实测**（`p8-sanitizer-dom.test.ts`）。
10. **分页/排序/ID 校验**：page 1–100_000、pageSize 1–200（非法 400）、ID 仅 `/^\d{1,20}$/`（防 BIGINT 溢出与注入）、排序白名单——57 个输入校验测试。

### F. 敏感信息
11. 密码/会话 token/csrf token/权限列表**只在服务端读取**；API 响应只回 `account.username`；审计日志详情递归 REDACT（password/token/secret/authorization/cookie/session/csrf 等）；登录/退出/重置审计只存账号名（会话失效数只存数量）。
12. `env.ts` zod 强校验：缺变量/空字符串即启动失败（fail-closed）；`NODE_ENV=production` 时拒绝 `dev-` 占位密钥、要求 `http(s)://` APP_URL 与合法 ADMIN_ALLOWED_ORIGINS。
13. 错误处理：API 错误只回 `{error, requestId, code}`；SQL/堆栈/连接串只写服务端日志（redactDatabaseUrl 掩密）；生产 `silent: true`（turbopack 确认支持）。

### G. 数据层与数据源
14. `CONTENT_SOURCE` 仅允许 `static|mysql`，**无 URL 参数切换、无自动回退**（双仓储无 fallback 分支）；mysql 异常返回 5xx 而非旧数据。
15. 池语义：查询错误 → **连接销毁不回池**（防多语句污染）；`multipleStatements` 关闭；时区 `+00:00`；BIGINT→string（精度）；迁移 fail-fast（部分失败退出码 1，journal 记录完整性可查）。
16. 导入安全：预览/执行分离、执行需 `import.execute`、**备份失败即不执行**（409 + 备份表 DROP 回滚）、备份表名正则 `^backup_[a-z0-9_]{1,40}$`、恢复前当前表必须先有备份表（三重来源校验）、恢复表名只允许 importableTables 白名单（403 拒绝其他）。
17. 审计只读：API 面只有 GET；`audit_logs` 无 UPDATE/DELETE 端点；导入/恢复/备份/管理员创建全部留审计。

### H. 构建与静态冻结
18. `output: 'standalone'` 已启用；lint/typecheck/build 全绿（P8 验收时点）；915 Vitest 全绿；P0–P8 Playwright 102 spec 用例 0 失败；**静态冻结 2759 文件 0 偏差、20 基线 SHA-256 全匹配**（本分支复验通过）。

---

## 四、存在问题（P9 处理，按严重级）

| # | 严重 | 问题 | 证据 | 处理阶段 |
|---|---|---|---|---|
| 1 | **高** | **上传目录不是持久卷**：compose 只挂 `facai8_mysql_data`；`/app/public/uploads` 在镜像可写层——**容器重建即丢** | docker-compose.yml | P9-2/P9-4 |
| 2 | **高** | **`MYSQL_ROOT_PASSWORD=root123456`**：弱 root 口令且 compose 明文；README 也把它当示例 | compose L6 | P9-5（生产改用强口令+外部 MySQL 或 secrets） |
| 3 | **中** | **compose 把 MySQL 发布到宿主机 3306（0.0.0.0）**：服务器有公网且防火墙不放行时 = 公网暴露 | compose L49 | P9-2/P9-5（删映射或绑 127.0.0.1） |
| 4 | **中** | **compose 引用未构建的镜像 `facai8-nextjs:local` + `restart: unless-stopped`**，compose 里**无应用 service**（README 指示手工 `docker run`）——应用重启策略与依赖编排缺失 | compose L26-36 | P9-2 |
| 5 | **中** | **应用容器以 root 运行**：Dockerfile 无 USER；`HOSTNAME=0.0.0.0`（README 已声明为已知问题） | Dockerfile | P9-2（加非 root 用户） |
| 6 | **中** | **上传无大小限制**：`uploadFile()` 无 size cap（仅类型/扩展名/路径校验），且 `UPLOAD_DIR` **未进 compose environment**（生产落 `public/uploads` 默认值） | services/uploads.ts、compose | P9-4 |
| 7 | **低** | README 与代码漂移：README 称「前台仍走静态数据」——P8 已双源（生产首轮仍是 static，符合任务书）；README 称 bootstrap-admin「必须显式 --yes」而代码已移除该门槛（现由登录强制改密兜底） | README vs 代码 | P9-2/收尾文档修正 |
| 8 | 低 | 后台暂无**用户密码自助修改**端点（管理员管理可重置他人密码，属 super_admin 权限）；审计要求「修改密码后旧会话失效」已实现（resetPassword 递增 version），但「本人改密」入口缺失 | admin.ts services | 记录；如需属 P9-1 后小增强（需批准） |

## 五、尚未验证（P9 各模块补齐）

1. **npm audit 结果未记录**（依赖漏洞清单从未归档）→ P9-1。
2. **Playwright 对 P8 修复轮的复跑**：最近一次完整跑在修复轮之前（102 spec 通过）；修复轮只跑了 Vitest/build/双渲染 → P9-1 复跑全量。
3. **Docker 实际构建与启动从未在本环境执行**（README 声明「本地没有 Docker 时不能声称已验证」）→ P9-2 实测。
4. **备份恢复从未实测**（mysqldump/参数/权限/恢复校验只有 README 命令）→ P9-3 实测。
5. **上传持久化从未实测**（上传 → 磁盘 → 容器重建 → 再访问）→ P9-4。
6. **最小权限账号从未创建/实测**（现在应用与迁移共用一个可建表的账号）→ P9-5 实测。
7. **HTTPS/HSTS 从未存在**（无域名/证书/服务器信息）→ P9-5 只能出模板。
8. **监控/告警为零**（无 5xx 计数、无连接池指标暴露、无备份监控；日志仅 console + requestId + mask）→ P9-6。
9. **磁盘/空间故障路径**：上传写失败已有 try→503；**磁盘满时导入备份表 CREATE TABLE 失败 → 409**（可接受）；审计日志写失败仅 console.error（不阻塞业务，风险记录）。
10. **慢查询/连接数**无观测手段（P9-6 给 SHOW STATUS/慢日志方案）。

## 六、需要用户提供（P9 阻塞项）

| # | 需要 | 用于 |
|---|---|---|
| U1 | 生产服务器地址/系统/是否已有 Docker | P9-2/5/7 |
| U2 | 真实域名 + TLS 证书（或 Let's Encrypt 意向） | P9-5 HTTPS/HSTS |
| U3 | 生产 MySQL 是独立服务器还是 compose 内建；现有 root/管理员账号与权限策略 | P9-5/7 |
| U4 | 正式管理员用户名（密码由用户自己提供/输入，**不得编造**）；P2 生产 bootstrap 尚未执行 | P9-7 |
| U5 | 备份存放位置与加密口令来源（不进 Git） | P9-3 |
| U6 | 防火墙/安全组操作授权（3306 关闭确认） | P9-5 |

## 七、P9 执行顺序确认

P9-0（本报告）→ P9-1 安全测试矩阵逐项核验+缺口补测（npm audit 归档、Playwright 复跑）→ P9-2 Docker（修 compose：应用 service、删 3306 公网映射、uploads 卷、非 root、健康检查）→ P9-3 备份/恢复实测（scratch 库）→ P9-4 上传持久化实测 → P9-5 网络/最小权限（新账号需批准；新 env 同步 4 处）→ P9-6 监控 runbook → P9-7 首轮 static 上线准备与回滚。

**本轮（P9-0）未修改任何代码**；静态冻结 2759 文件 0 偏差复验通过。
