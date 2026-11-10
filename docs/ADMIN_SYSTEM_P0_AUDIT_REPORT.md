# P0 审计报告：仓库审计与基线检查

> 阶段：P0（仓库审计与基线）
> 日期：2026-11-10
> 执行基线：`L:\2026ai-website-cloner-template` @ master `f0156d2`
> 执行合同：`docs/skills/admin-system-development/SKILL.md`（12 条不可违反约束全部核对）
> 状态：**P0 完成，等待用户验收；未开始任何后台业务代码**

---

## 0. 摘要

- 仓库基线与文档描述一致：Next 16.3.5 / React 19.2.4 / Node ≥24 / npm / lockfile / Tailwind 4 / standalone / Docker 三阶段，**当前没有任何 MySQL 驱动、ORM 或管理后台代码**（`src/app/admin`、`src/lib/admin`、`src/lib/db`、`drizzle/`、vitest/playwright 配置均不存在）。
- 基线命令全部通过：`npm run lint` ✅、`npm run typecheck` ✅、`npm run build` ✅、dev server 启动 ✅（346ms，控制台 0 错误）。
- 静态快照 20 个文件全部可解析、引用关系完整；图片引用 0 缺失；**发现 1 处真实数据缺口**（CAT_ORDER 6 个孤儿 ID，P4 导入策略必须处理）。
- 发现 10 项仓库/文档问题（F1–F10），其中 3 项需 P1 处理（`.env` 被跟踪、`.gitignore` 模板残留 `docs/` 规则、`tsconfig.tsbuildinfo` 被跟踪），1 项已在本阶段修正（技术设计文档数据文件表遗漏 `searchDescriptions.ts`）。
- 本阶段未修改 `src/` 下任何文件；`src/lib/facai8/data/` Git diff 为零。

---

## 1. 执行前检查清单（SKILL §2 逐项）

| 检查项 | 结果 |
|---|---|
| `git status --short` | 空（干净工作区，无用户未提交改动，无覆盖风险） |
| `git branch --show-current` | `master`（最近 8 次提交 = 5 份 admin 文档 + 文档索引 + 模板基线） |
| package.json / lockfile 版本 | next 16.3.5、react 19.2.4、react-dom 19.2.4、@base-ui/react 1.3.0、typescript 5.9.3、tailwindcss 4.2.2、eslint 9.39.4、eslint-config-next 16.3.5、lucide-react 1.6.0；engines `node >=24` |
| 本机运行时 | Node v24.22.2 / npm 11.19.1（满足 ≥24）；`node_modules` 已安装 |
| `src/app` 路由枚举 | 21 个 `page.tsx` + 9 个 `route.ts`（见 §3） |
| `src/lib/facai8/data` 枚举 | 20 个文件（见 §4；文档表遗漏 1 个，已修正） |
| 前台组件数据字段确认 | 完成（见 §5 字段映射；43 个站点组件 + 1 个 ui 文件） |
| 已有 docs 检查 | `docs/` 根目录 4 份 admin 文档 + README 索引（tracked）；克隆档案 `docs/research/`、`docs/design-references/` 在磁盘存在但被 gitignore 规则忽略（见 F4）；新增文件不覆盖任何既有文档 |
| 基线 lint / typecheck / build | 全部通过（见 §8） |
| 桌面 + 移动截图 | 17 张，见 §9 |
| 静态数据计数 | 见 §4 |

---

## 2. Git 与仓库卫生

| 项 | 现状 | 处置 |
|---|---|---|
| 工作区 | 干净（审计开始时 `git status --short` 为空） | — |
| `.env` | **被 Git 跟踪**（`git ls-files` 命中），内容为本地演示凭据 `SOURCE_TEST_USERNAME=demo` / `SOURCE_TEST_PASSWORD=*** 密钥） | **F3 → P1**：`git rm --cached .env` + 补 `.env`/`.env.local` ignore 规则，并新增 `.env.example` |
| `.gitignore` | 模板残留：`docs/` 整目录忽略、乱码 GBK 注释、无关条目（`/00back00` 等） | **F4 → P1** 修正。后果：新增 `docs/` 文件默认不入版本库（需 `git add -f`）；5 份 admin 文档是显式强加跟踪的 |
| 克隆档案文档 | `docs/research/`（334 文件）、`docs/design-references/`（含 332 文件）、`docs/tasks/` 均 `!!` 未跟踪 | 仅记录，不移动；克隆交付物留在本地磁盘 |
| `tsconfig.tsbuildinfo` | 被跟踪的构建产物 | **F5 → P1**：untrack + ignore |
| 构建/运行日志 | `.npm-check-*.log` 已忽略 ✅ | — |

---

## 3. 路由地图（重新枚举，非引用历史统计）

**页面（21，全部 `ƒ` 动态）：**

| 路由 | 数据/行为 |
|---|---|
| `/` | 公告条 + 14 首页广告 + 60 分类区块 + 侧栏（stats/最新收录/线路/联系我们） |
| `/category/[categoryId]` | 分类网址列表（CAT_ORDER 排序 + isGone 过滤） |
| `/link/[id]` | 网址详情（LINK_DETAILS/LINK_MIRRORS 可选子资源） |
| `/articles` | 文章列表（ARTICLE_CATEGORIES 分栏） |
| `/articles/[id]` | 文章详情（富文本 localHtml 图片映射） |
| `/bulletin/[id]` | 公告详情 |
| `/search` | 站内搜索（title/description/content 本地匹配） |
| `/lines` | 线路列表（5 条） |
| `/tag/[tagId]` | 标签列表（TAG_ORDER 排序） |
| `/about` `/agreement` `/disclaimer` `/privacy` | 静态页（SITE_STATIC 4 键） |
| `/login` `/register` `/forgot-password` | Mock 会员认证（facai8_session，见 §6） |
| `/profile` `/favorites` `/my-posts` `/my-comments` | **服务端登录守卫**：未登录 `redirect('/login?redirect=…')`；登录后为 Mock 空态/演示 |
| `/submit-article` | 投稿表单 UI，提交为 Mock（无持久化） |

**API（9，全部 `force-dynamic`）：** `/api/auth/{login, login-by-code, register, forgot-password-code, reset-password, send-login-code, send-register-code, captcha, logout}`

**渲染语义：** 21+9 全部动态（页面调用 `cookies()` 取会员态渲染 Header），仅 `/_not-found` 预渲染 —— 与克隆交付文档（DELIVERY/progress）记录一致。build 输出 31 条路由、19 个预渲染壳。

---

## 4. 静态数据字典（`src/lib/facai8/data/`，20 文件，只读未动）

| 文件 | 导出 | 实际计数 | 记录形状（关键字段） |
|---|---|---|---|
| categories.ts | `LINK_CATEGORIES: CatNode[]` | 60 顶层 + 34 子分类 = 94 节点 | id/name/icon(sortOrder 为字符串)/children[] |
| links.ts | `ALL_LINKS: LinkItem[]` | 3791（ID 全唯一） | id/categoryId/logoUrl/url/title/description/isGone(0\|1)/tagId(nullable)；isGone=1 共 83 条；带 tagId 143 条 |
| link-order.ts | `CAT_ORDER: Record<string,string[]>`、`TAG_ORDER`、`applyLinkOrder` | CAT_ORDER 90 个分类桶 / 3797 条；TAG_ORDER 3 键 | 值 = 链接 ID 数组（原始顺序快照） |
| link-details.ts | `LINK_DETAILS: Record<string,LinkDetailExtra>` | 122 | id/clickCount/likeCount/createdAt/updatedAt/annotation/previewImage/logoUrl/categoryName/detail（HTML） |
| link-mirrors.ts | `LINK_MIRRORS: Record<string,LinkMirror[]>` | 66 个链接 / 98 条备用 URL | 值 = 备用链接数组 |
| tags.ts | `TAGS: Tag[]` | 5 | id/name/icon/color/bg |
| articles.ts | `ALL_ARTICLES: Article[]` | 28（ID 全唯一） | id/title/content(HTML)/coverImage/categoryId+categoryName/seo*3/viewCount(字符串)/createdAt/updatedAt/authorName/authorAvatar |
| article-categories.ts | `ARTICLE_CATEGORIES: ArticleCategory[]` | 5 | id/name/icon |
| bulletins.ts | `BULLETINS: Bulletin[]` | 1 | id/title/content/时间 |
| ads.ts | `HOME_ADS: Ad[]` | 14（全部 position=home） | id/linkUrl/imageUrl/title |
| lines.ts | `ALL_LINES: LineItem[]` | 5 | id/name/url |
| site-info.ts | `SITE_INFO` | 6 键 | siteName/siteDescription/siteLogo/siteFavicon/footerText/adsRandom |
| icon-libraries.ts | `ICON_LIBRARIES` | 5 | 图标字体库（prefix/hash/cssPath） |
| site-static.ts | `SITE_STATIC` | 4 键 | aboutUs/disclaimer/agreement/privacy（HTML 静态页） |
| popup.ts | `HOME_POPUP` | 1 | enabled/title/content |
| stats.ts | `STATS` | 4 键 | links/articles/comments/totalViews（展示用数字） |
| searchDescriptions.ts | `SEARCH_DESCRIPTIONS: Record<string,string>` | 25 键 | 搜索结果摘要快照（源站搜索接口存档） |
| new-links.ts / recent-links.ts / new-articles.ts | `NEW_LINKS` / `RECENT_LINKS` / `NEW_ARTICLES` | 10 / 10 / 8 | 首页侧栏派生列表 |

**引用完整性（脚本 `ts.transpileModule` 转译后程序化校验）：**

| 校验 | 结果 |
|---|---|
| 分类 ID 重复 / 子分类父引用 | 0 重复，0 错误父引用 ✅ |
| links → categoryId | 0 孤儿 ✅（最大桶 638 条） |
| links → tagId | 0 孤儿 ✅ |
| CAT_ORDER 链接 ID → ALL_LINKS | **6 个孤儿 ID**（113168232969539584、113176904370098176、113174231788949504、113165953772163072、113161221603201024、113175765650116608）→ **F2** |
| 3791 链接被 CAT_ORDER 覆盖 | 3791/3791 ✅（桶内含 6 条重复引用） |
| LINK_DETAILS / LINK_MIRRORS 键 → links | 0 孤儿 ✅ |
| articles → article category | 0 孤儿 ✅ |
| new-links/recent-links/new-articles → 主数据 | 0 缺失 ✅ |

**CAT_ORDER 孤儿成因：** 各快照文件由源站接口在不同时刻采集（2026-11-08 前后），排序快照采到的 6 条链接在 all-links 快照中已不存在。与 `LINK_DETAILS 缺失不建记录` 同理：**P4 导入策略 = 跳过孤儿排序条目，绝不伪造记录**（已写入实施计划 P4）。

**媒体资产：** `public/sites/facai8/` = images/ 2736 文件（1834 png / 496 ico / 324 webp / 64 jpg / 17 gif / 1 bmp）+ fonts/ 15。按 `asset()` 真实映射规则（`/uploads/…` → `/sites/facai8/images/{basename}`）校验全部引用：2528 logo + 28 封面 + 119 详情预览图 + 14 广告图 + 70 篇正文内嵌图 = **0 缺失** ✅。

---

## 5. 数据字段映射（数据文件 → 前台消费者）

| 数据 | 消费位置 | 用途 |
|---|---|---|
| `SITE_INFO` | `app/layout.tsx`（metadata）、Header、SiteFooter、13 个页面的 generateMetadata | 站名/描述/Logo/页脚 |
| `LINK_CATEGORIES` | `/`、`/category/[id]`、ArticleDetail、SubmitArticle、MobileBar/SideNav/CatSection/HomeShell/ArticlesShell | 分类树与图标（iconfont class） |
| `ALL_LINKS` | `/`、`/category/[id]`、`/link/[id]`、`/tag/[id]`、util 搜索/相关推荐 | 网址主数据 |
| `CAT_ORDER`/`TAG_ORDER`/`applyLinkOrder` | `/`、`/category/[id]`、`/tag/[id]` | 分类内/标签内顺序 |
| `LINK_DETAILS` | `/link/[id]`、ArticleDetail（点击数/收藏/标注/预览图/详情） | 可选一对多补充 |
| `LINK_MIRRORS` | `/link/[id]`（util `mirrorsForLink`） | 备用链接 |
| `TAGS` | `/tag/[id]`、LinkDetail（util `tagById` 徽章） | 标签 |
| `ALL_ARTICLES` | `/articles`、`/articles/[id]`、util 搜索/相关网址 | 文章主数据 |
| `ARTICLE_CATEGORIES` | `/articles`、Header 导航、SubmitArticle | 文章分类 |
| `BULLETINS` | 首页公告条、`/bulletin/[id]` | 公告 |
| `HOME_ADS` | 首页 AdPromo、`/link/[id]`、`/articles/[id]` | 14 首页广告 |
| `ALL_LINES` | `/lines` | 线路 |
| `ICON_LIBRARIES` | Header 注入 iconfont `<link>`/CSS | 图标字体 |
| `SITE_STATIC` | SiteInfoPage（about/agreement/disclaimer/privacy） | 4 静态页 |
| `HOME_POPUP` | HomePopup | 首页弹窗 |
| `STATS` / `NEW_LINKS` / `RECENT_LINKS` / `NEW_ARTICLES` | HomeRail 侧栏 | 展示数字 + 最新列表 |
| `SEARCH_DESCRIPTIONS` | util `searchArticles`（缺失时回退本地截断规则） | 搜索摘要快照 |

---

## 6. 认证机制盘点（必须与后台完全隔离）

**前台 Mock 会员（`src/lib/facai8/auth.ts` + `auth-api.ts` + `captcha.ts` + `auth-rules.ts`）：**

- Cookie `facai8_session`：HttpOnly、SameSite=Lax、Path=/、Max-Age 7 天；值 = base64url(JSON `{u, a, s}`)。
- **关键事实（比文档描述更弱）：** `s` 字段 = `sha256(username + randomUUID())` 截 32 位 —— 每次登录随机生成且 `getSessionUser()` **从不做任何签名/摘要校验**，任意合法 base64 JSON 即可伪造会话。文档"只是 Base64 编码"的表述成立，实际上连伪校验都没有 → 强化约束 6（不得复用于管理员认证）。
- 凭据判定 `credentialsOk`：`.env` 注入 `SOURCE_TEST_USERNAME/PASSWORD`（demo/Demo1234）→ 仅该账号可登录；未注入 → 任意非空凭据放行（console.warn 演示兜底）。
- 图片验证码：手写 PNG（90×36）+ **进程内 Map**（10 分钟 TTL、一次消费）——单实例 mock，无持久化。
- 9 个 API 全部 `force-dynamic`；登录成功返回源站同形 `{code:200,data:{token,username}}` 并写 cookie。
- 会员区 4 页（profile/favorites/my-posts/my-comments）：服务端 `redirect('/login?redirect=…')` 守卫；登录后为 Mock 空态。**无真实用户表/数据** —— 不可据以前台"会员功能存在"推断后台第一期范围（与 TECHNICAL_DESIGN §1.2 非目标一致）。

**对后台的硬隔离要求（SKILL 约束 6，复核确认）：** 独立 `admin_users/admin_sessions`、独立 Cookie `facai8_admin_session`、Argon2id、`crypto.randomBytes(32)` token + 库存 SHA-256 摘要、服务端 RBAC；`getSessionUser()`/`facai8_session`/`SOURCE_TEST_*` 在 admin 代码中零引用。

---

## 7. 组件 / CSS / 依赖复用评估

- `src/components/`：44 文件 = `sites/facai8/` 43（SiteFrame/Header/各 Shell/卡片/详情等，全部自定义样式）+ `ui/` 1。模板宣称的 shadcn 原语**并未实际搭建**——后台 P5 的 DataTable/表单等组件需全新编写（可复用 Base UI 依赖 `@base-ui/react 1.3.0` 与 Tailwind 4 token 体系）。
- 后台 AdminLayout **不得**复用 SiteFrame（前台导航布局）；样式走 Tailwind v4 设计 token，与前台站点 CSS 隔离。
- `src/types/`、`src/hooks/` 为空（仅 .gitkeep）——后台 DTO 目录按 SKILL §3 新建 `src/lib/admin/dto/`。
- 依赖缺口（P1 目标集）：mysql2 / drizzle-orm / drizzle-kit / argon2 / sanitize-html / vitest / playwright 均不在 lockfile；**zod 4.3.6 已作为传递依赖存在**（F8），P1 直接依赖时固定同主版本即可。

---

## 8. 基线命令（真实执行结果）

| 命令 | 结果 | 备注 |
|---|---|---|
| `npm run lint` | ✅ 通过，0 错误 | 仅 Babel 提示 `links.ts` 超 500KB 退优化（信息性，非失败） |
| `npm run typecheck` | ✅ 通过，0 错误 | tsc --noEmit（strict） |
| `npm run build` | ✅ 通过 | 23.1s 编译（Turbopack）→ TS → 19/19 静态壳 → 31 路由全部列出 |
| `npm run dev` | ✅ Ready 346ms | 本次用于截图；审计完成后已停止 |
| 运行时控制台 | 0 error（playwright 抓取 11 路由） | — |

**失败项：无。** 不存在"把原有失败报为通过"的情况（因为基线本来就全绿）。

---

## 9. 截图基线（新增文件）

位置：`docs/design-references/facai8/admin-p0-baseline/`（17 张 PNG，均在 gitignore `docs/` 规则内 → 本地档案，不入版本库，与克隆档案同待遇）。

| 页面 | 桌面 1440×900 | 移动 390×844 |
|---|---|---|
| 首页 `/` | desktop-home.png（712KB，已视觉核验） | mobile-home.png |
| 分类 `/category/94018707302518784` | desktop-category.png | mobile-category.png |
| 网址详情 `/link/112546110991634432` | desktop-link-detail.png | mobile-link-detail.png |
| 文章列表 `/articles` | desktop-articles.png | mobile-articles.png |
| 文章详情 `/articles/112450241390841856` | desktop-article-detail.png | mobile-article-detail.png |
| 登录 `/login` | desktop-login.png（已视觉核验） | mobile-login.png |
| 线路 / 标签 / 关于 / 搜索 / 收藏(未登录→登录页) | desktop-{lines,tag,about,search,favorites-logout}.png | — |

视觉核验结论：首页公告条、14 广告轮播、60 分类侧栏、3.8K/28/17/146.8K 统计、最新收录栏全部渲染；`/favorites` 未登录正确跳转登录页。

---

## 10. 问题清单（F1–F10）

| # | 级别 | 问题 | 处置 |
|---|---|---|---|
| F1 | 文档 | TECHNICAL_DESIGN §2.3 数据表遗漏 `searchDescriptions.ts`（25 键搜索摘要快照） | **本阶段已修正**（补表行） |
| F2 | 数据 | CAT_ORDER 含 6 个 ALL_LINKS 中不存在的 ID（快照时间差） | **P4**：导入跳过孤儿条目，不建记录；导入报告必须显式列出 |
| F3 | 安全/卫生 | `.env` 被 Git 跟踪；`.gitignore` 无 `.env*` 规则 | **P1**：untrack + ignore + `.env.example`（SKILL P1 要求） |
| F4 | 卫生 | `.gitignore` 模板残留 `docs/` 整目录忽略（克隆档案 600+ 文件不在版本库；新文档需 `-f`） | **P1** 修正规则（建议：仅忽略克隆档案子目录，admin 文档保持跟踪） |
| F5 | 卫生 | `tsconfig.tsbuildinfo` 构建产物被跟踪 | **P1**：untrack + ignore |
| F6 | 信息 | 前台 mock session 无签名校验（`s` 随机且不验证） | 不改前台（冻结）；后台独立认证已覆盖风险 |
| F7 | 部署 | docker-compose 无 MySQL 服务、无上传目录卷 | **P1** 增加 mysql 服务 + 独立持久卷，应用 env 与 DB 凭据分离 |
| F8 | 依赖 | zod 4.3.6 已在 lockfile（传递依赖） | **P1**：直接依赖固定 zod 4.x 同主版本 |
| F9 | 决策 | 派生快照（stats/new-links/recent-links/new-articles）无 DDL 对应表 | **P4 决策点**：推荐"不建管理表，读取时从主表派生"，待 P4 评审 |
| F10 | 映射 | 静态 `Ad.imageUrl/linkUrl` ↔ DDL `ads.image_path/target_url`；静态无 status 字段 ↔ DDL enum | **P4**：字段重命名映射 + 默认 `status='active'`（DDL 无需改） |

---

## 11. SKILL §9 阶段报告格式

### 本阶段结果
- 完成项：执行前检查清单 11/11（§1）；路由地图 31 路由（§3）；静态数据字典 20 文件 + 引用完整性（§4）；字段映射 18 组（§5）；认证盘点（§6）；组件/CSS/依赖评估（§7）；基线命令（§8）；截图 17 张（§9）；问题清单 F1–F10（§10）。
- 修改文件：`docs/ADMIN_SYSTEM_TECHNICAL_DESIGN.md`（§2.3 补 `searchDescriptions.ts` 行）、`docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md`（P0 勾选 + 结果指针）。
- 新增文件：`docs/ADMIN_SYSTEM_P0_AUDIT_REPORT.md`（本文件）、`docs/design-references/facai8/admin-p0-baseline/*.png`（17，gitignore 内）。
- 新增数据库迁移：无（P0 不写业务代码）
- 新增 API/页面：无
- `src/` 目录改动：**零**（`src/lib/facai8/data/` diff 为零 ✅）

### 验证
- `npm run lint`：✅ 通过（0 错误）
- `npm run typecheck`：✅ 通过（0 错误）
- `npm run build`：✅ 通过（31 路由；仅信息性 Babel 提示）
- 单元/集成/e2e：P0 不适用（仓库尚无测试框架；截图为 playwright 驱动 + 控制台 0 错误）
- 前台回归：11 路由渲染核验 + 17 截图；无回归（未改任何前台代码）
- 未执行项：无遗漏；无"未执行却报通过"

### 风险与后续
- 未完成项：无（P0 范围全部完成）
- 发现的问题：F2/F3/F4/F5/F7/F8 需在 P1/P4 处置（见 §10）
- 需要用户确认：
  1. 验收 P0 并放行 P1；
  2. F3/F4/F5 属"仓库卫生修正"而非后台业务代码——确认允许在 P1 一并处理（建议一并，因 P1 新增 `.env.example`/依赖时若不同步修会再次污染）；
  3. F9 派生快照处置策略（推荐 P4 读取时派生，不建表）——P4 评审时定案；
  4. 截图档案留在 gitignore 的 `docs/` 内（与克隆档案一致）还是修正规则后入库——随 F4 决策。
- 下一阶段建议：**P1**（依赖与数据库连接）：固定 mysql2/drizzle-orm/drizzle-kit/argon2/sanitize-html/vitest/playwright 具体版本并核对 Node 24 + Next 16.3.5 兼容 → Zod env schema（`CONTENT_SOURCE=static` 默认）→ `src/lib/db/client.ts`（mysql2 pool + `bigNumberStrings` + server-only）→ `drizzle.config.ts` → `.env.example` + F3/F4/F5 卫生修正 → compose 增加 MySQL 服务（F7）；验收 = 无 DB 下 static 正常启动 + 有 DB 下 `SELECT 1` + lint/typecheck/build 全绿。
