# 后台管理系统安全机制、测试与回归规范

## 1. 安全目标

后台管理系统能够修改站点公开内容和站点配置，属于高权限入口。必须默认拒绝、服务端授权、最小权限、可审计和可恢复。前台 Mock 会员认证不构成后台安全措施。

## 2. 身份认证

### 2.1 管理员账号
- 管理员账号保存在 admin_users。
- 密码仅存 Argon2id hash，不存明文、不加密可逆存储。
- 密码策略：至少 12 位；允许密码管理器生成的长密码；不强制复杂字符组合但禁止常见弱密码。
- 首次登录强制修改 bootstrap 密码。
- 管理员禁用、密码重置、角色变更需写审计日志。
- 生产环境不提供公开管理员注册。

### 2.2 Session
- 使用 crypto.randomBytes(32) 生成随机 Session token。
- 数据库只存 SHA-256(token)，不能存明文 token。
- Cookie：facai8_admin_session。
- 属性：HttpOnly、Secure（production）、SameSite=Lax、Path=/、Max-Age 与数据库 expires_at 一致。
- Session 服务端校验用户状态、expires_at、revoked_at。
- 登出、管理员禁用、密码修改、强制下线时撤销 Session。
- 权限变化应在每次请求重新加载或使用短期安全缓存，不能让旧权限长期有效。
- 不允许把 Session token 放 localStorage、URL、日志或客户端组件状态。

### 2.3 Cookie 隔离
- 管理员 Cookie 与前台 facai8_session 完全分离。
- getSessionUser() 仅供现有前台使用，禁止作为后台守卫。
- SOURCE_TEST_USERNAME/PASSWORD 不得用于管理员账号。
- 后台身份校验必须发生在服务端。

## 3. RBAC 权限模型

权限采用资源.动作，例如：
- dashboard.read
- categories.read/create/update/delete
- links.read/create/update/publish/delete
- articles.read/create/update/publish/delete
- bulletins.read/create/update/publish/delete
- ads.read/create/update/delete
- tags.read/create/update/delete
- lines.read/create/update/delete
- settings.read/update
- administrators.read/create/update/disable/assign_role
- audit_logs.read
- imports.preview/execute

角色仅是权限集合，不在业务代码中散落 role === 'admin' 判断。Service 和 API 都要进行服务端权限检查。客户端菜单隐藏不是授权边界。

建议初始角色：
- super_admin：全部权限。
- content_admin：日常内容管理，不可改管理员、权限和安全设置。
- content_editor：内容编辑，不能发布或删除（按业务可调整）。
- auditor：只读。

保护最后一个 active super_admin：不能禁用、删除或移除其 super_admin 角色，除非另一个 active super_admin 已存在。

## 4. CSRF、CORS 和请求校验

- 后台 Cookie 使用 SameSite=Lax，但不能只依赖 SameSite。
- 所有写请求检查 Origin 与 Host/配置的站点 Origin 白名单。
- 对跨站请求拒绝；必要时使用同步 CSRF token 或 double-submit token。
- 不允许对后台 API 开放通配 CORS。
- GET/HEAD 不产生状态修改。
- POST/PATCH/DELETE 校验 Content-Type。
- 反向代理正确配置 X-Forwarded-Proto/Host，信任代理层必须受限，不能盲信任任意客户端转发头。

## 5. 登录防护

- 对 username hash + IP hash 组合限流。
- 连续失败触发指数退避和短时锁定。
- 返回统一错误文案，避免账号枚举。
- 对登录 API 设置合理请求体大小。
- 记录失败事件但不记录密码、Cookie 或 token。
- 登录成功轮换 Session，防止 Session fixation。
- 支持管理员主动撤销所有 Session。
- 管理后台优先限制 IP/VPN；若公网开放，建议增加 MFA（TOTP/WebAuthn）作为后续阶段。

## 6. 输入校验与 SQL 安全

- 所有 API 输入使用 Zod schema。
- ID 作为十进制数字字符串验证，禁止 Number() 转换可能超出安全整数范围。
- 所有 SQL 值使用参数化查询/Drizzle 参数绑定。
- sortBy、sortOrder、字段选择必须使用服务端 allowlist。
- page >= 1；pageSize 默认 20、最大 100。
- 限制字符串长度、数组长度、请求体大小。
- 网址仅允许 http/https；拒绝 javascript:、data:、file: 等协议。
- 不在保存或预览时主动 fetch 用户提交的第三方 URL，避免 SSRF。
- 日志中对 URL query 中可能含 token 的参数进行脱敏。

## 7. XSS 与富文本

- 文章、公告、site_pages 富文本服务端清洗。
- 使用 sanitize-html allowlist 标签、属性和协议。
- 移除 script、iframe、object、embed、form、事件处理属性、javascript:、data: 危险 URL、危险 SVG。
- 不把未经清洗的 HTML 直接 dangerouslySetInnerHTML。
- 对 HTML 预览使用同样 sanitizer。
- URL 与图片地址按白名单校验。
- 上传文件 MIME、扩展名、文件头签名同时检查，不能只信浏览器 Content-Type。
- 图片文件随机化存储名，限制大小和像素，避免 SVG/HTML 作为可执行内容上传。
- 上传目录不可执行，禁止路径穿越和 ../。

## 8. 资源上传和文件安全

第一期优先复用仓库已有 public/sites/facai8/images 资源，避免立即引入上传面。
若实现上传：
- 使用独立持久化目录，例如 /data/facai8/uploads。
- 文件元数据记录在 media_assets，数据库不存 BLOB。
- 文件名由服务器生成 UUID/随机名，原文件名仅用于展示。
- 限制 JPEG/PNG/WebP/GIF 等明确允许格式；SVG 默认拒绝，除非有独立消毒流程。
- 单文件大小、像素尺寸、总存储空间设上限。
- 上传成功后校验哈希和文件可读性。
- 删除媒体前检查是否被文章、广告、站点设置引用。
- 备份同时覆盖 MySQL 和上传目录。

## 9. 审计日志

每次成功的管理写操作记录：
- actor_user_id
- action
- resource_type/resource_id
- before_json/after_json
- request_id
- IP、User-Agent
- created_at

脱敏字段：password/password_hash、session/token、Cookie、Authorization、DB_PASSWORD、验证码密钥和任何凭据。
审计记录不可由普通管理员编辑或删除。日志写入应与业务事务保持一致；如审计写入失败，关键管理写操作应整体回滚，不能静默忽略。

## 10. 数据库与运行安全

- MySQL 不对公网开放，使用私网或本机连接。
- 应用使用专用数据库账号，最小权限；migration 使用独立部署账号。
- 禁止应用以 root 连接。
- TLS 连接跨主机数据库。
- DB 密码只通过环境变量/Secret Manager 注入。
- 不提交 .env/.env.local。
- 日志禁止打印连接串。
- 连接池设置连接数上限、超时、空闲回收。
- 迁移前备份，migration 显式执行，不在每次应用启动时自动执行。
- 备份加密并异地存储，定义保留周期。
- 定期做恢复演练，而不是只确认 dump 文件存在。
- 生产容器以非 root 用户运行；上传目录最小权限。
- Nginx HTTPS；启用安全响应头。HSTS 仅在 HTTPS 域名稳定后启用。

## 11. 测试矩阵

### 11.1 认证和权限

| 用例 | 预期 |
|---|---|
| 未登录访问 /admin | 重定向到 /admin/login |
| 未登录调用后台 API | 401 |
| 伪造 facai8_session | 仍然 401 |
| 普通 editor 调用管理员 API | 403 |
| 已禁用管理员旧 Session | 401/403，不能继续使用 |
| Session 过期 | 401 |
| 登出后重放 Cookie | 401 |
| CSRF Origin 不匹配 | 403 |
| 连续失败登录 | 429/临时限制 |
| 管理员不存在与密码错误 | 对外错误文案一致 |
| 角色变更后旧权限 | 下一次请求立即按新权限检查 |

### 11.2 内容和数据校验

| 用例 | 预期 |
|---|---|
| 分类 ID 非数字字符串 | 400 |
| 分类存在子分类时删除 | 409/422 |
| 分类仍有关联网址时物理删除 | 拒绝 |
| URL 为 javascript: | 422 |
| URL 为 file:// 或 data: | 422 |
| title 超长 | 400 |
| pageSize=10000 | 拒绝或限制为 100 |
| sortBy=SQL 注入字符串 | 拒绝 |
| BIGINT 17 位 ID | 字符串无损读写 |
| 重复 URL（若业务不允许） | 409 |
| version 过期更新 | 409 |
| 事务中途失败 | 全部回滚 |
| 软删除数据 | 默认列表隐藏，审计保留 |

### 11.3 XSS 与上传

测试 payload：
- <script>alert(1)</script>
- <img src=x onerror=alert(1)>
- <a href="javascript:alert(1)">x</a>
- <iframe src="https://evil.example"></iframe>
- SVG onload payload
- HTML 中的 data:text/html URL

预期：保存后危险节点/属性被清洗；浏览器中不能执行脚本。

上传测试：
- 伪造扩展名
- 超大文件
- 超大像素图片
- ../ 路径
- SVG/HTML 文件
- 重复内容 hash
预期：按白名单拒绝或安全规范化，文件不能写出 upload root。

### 11.4 导入测试

- dry-run 不改变 DB。
- 首次导入计数与源快照一致。
- 重复导入默认拒绝。
- 断点/失败导入有失败记录且不会假报成功。
- category_id/tag_id/article category FK 全部有效。
- 详情仅导入原始存在记录。
- mirrors 的 link_id 有效。
- CAT_ORDER 顺序映射一致。
- 图片引用路径存在性校验。
- 17 位 ID 无精度损失。
- 管理员已修改的记录不会被再次导入覆盖。
- 原始静态数据文件 Git diff 为零。

### 11.5 前台回归

至少检查：
- /
- /category/[有效一级分类 ID]
- /category/[有效二级分类 ID]
- /link/[有详情的有效 ID]
- /link/[无详情的有效 ID]（当前预期仍按现有 notFound 行为）
- /articles
- /articles/[有效文章 ID]
- /bulletin/[有效公告 ID]
- /search?q=关键词
- /tag/[有效 tag ID]
- /lines
- /about
- /agreement
- /disclaimer
- /privacy
- /login
- /register
- /profile、/favorites、/my-posts、/my-comments（未登录跳转行为保持）

对比静态模式下的页面标题、描述、链接数量、顺序、分类、图标、图片和空态。

## 12. 发布前检查

- [ ] npm run lint
- [ ] npm run typecheck
- [ ] npm run build
- [ ] Vitest unit/integration
- [ ] Playwright e2e
- [ ] Docker build
- [ ] 容器重启后 Session/DB/媒体行为符合设计
- [ ] MySQL 备份
- [ ] MySQL 恢复演练
- [ ] 上传目录恢复演练
- [ ] Nginx 反向代理和 HTTPS 检查
- [ ] 公网扫描确认 MySQL/3000 未暴露
- [ ] CONTENT_SOURCE=static 最终回归
- [ ] 原始静态文件未被修改

## 13. 安全事件响应

若管理员账号疑似泄露：
1. 禁用账号或撤销全部 Session。
2. 修改密码并检查管理员角色。
3. 检查登录失败记录和审计日志。
4. 检查是否新增管理员、权限或站点脚本。
5. 检查数据库和媒体文件异常修改。
6. 从可信备份恢复前先保全日志和现场。
7. 轮换 DB 凭据、部署密钥和其他可能暴露的 Secret。
8. 记录事件时间线和修复措施。

## 14. 明确未包含的风险承诺

本文件是工程安全要求，不代表已经完成安全审计或渗透测试。未执行的测试不得标记通过。正式公网开放前建议进行独立安全审查。

## 15. P6D 实施与测试执行记录（2026-11-12）

P6D（广告 / 线路 / 站点设置）已按下述规范实施并通过测试：

- **RBAC**：复用 seed 既有权限码 `ads.view/create/update/delete`、`lines.*`、`settings.view/settings.update`；全部在 API Handler 层强制（403 无副作用、不写审计）；UI 按权限标志隐藏对应动作。auditor 三角色只读实测通过。
- **CSRF / Origin**：沿用 P3 组合防护；P6D 全部写路由（POST/PATCH/DELETE）实测携带 `X-CSRF-Token` 通过。开发环境注意：`ADMIN_CSRF_SECRET` 缺省时按进程随机回退，Turbopack 热重编译会轮换密钥导致刷新后写请求 403（生产必须显式配置，已在 env 校验中 fail-closed）。
- **SSRF 防护**：广告 `targetUrl` 与线路 `url` 仅做完整 http(s) 格式校验（禁 `javascript:`/`data:`/`file:` 等），服务端与后台 UI 均不发起对目标地址的抓取；UI 预览只打开站内图片路径。
- **媒体路径安全**：广告 imagePath、settings `site_logo`/`site_favicon` 走统一媒体策略（根前缀白名单 + 已知图片后缀 + 禁 SVG/HTML/查询串/外链）并叠加服务端磁盘存在性校验（`src/lib/admin/security/media-file.ts`，server-only；legacy `/uploads/...` 按 basename 映射 `public/sites/facai8/images/`，与前台冻结 asset() 同口径）；缺文件 422。
- **审计**：`ad.*`、`line.*`（create/update/status/reorder/soft_delete/restore）与 `setting.update` 均在写事务内落库；403/409/422 不产生日志；跳转 URL 编辑仅记摘要/长度/哈希（`url-audit.ts`）。
- **并发保护**：所有 P6D 写路径逐行 `version` 乐观锁（409 统一文案），reorder/settings 批量为单事务整批回滚；settings 按键名排序 `FOR UPDATE` 锁行，实测外部抢先保存触发 UI 409 静默回取版本。
- **测试**：`npm run test:admin` = vitest 39 文件 / 684 用例全绿（真实 MySQL scratch 库 `facai8_p6d_test`）；P6D 新增 `p6d-ads-api`、`p6d-lines-api`、`p6d-settings-api`、`p6d-media-path` 4 个测试文件（+ `p6d-harness` 夹具）；未删除或放宽任何既有用例。lint / typecheck / build 全部通过。
- **前台冻结回归**：`src/lib/facai8/data/` 20 文件 blob 与基线 20/20 逐字节一致；`src/lib/facai8`、`public` git diff 为空；`CONTENT_SOURCE=static` 下 9 条前台路由（/、/lines、/articles、文章详情、公告详情、/about、/agreement、/disclaimer、/privacy）全部 200。
