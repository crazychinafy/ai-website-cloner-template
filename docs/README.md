# 项目文档索引

## 后台管理系统

本目录新增了后台管理系统的完整设计和执行文档。后台使用现有 Next.js/Node.js 应用 + MySQL，默认保留前台静态 Mock 快照。

| 文件 | 内容 | 使用场景 |
|---|---|---|
| [ADMIN_SYSTEM_TECHNICAL_DESIGN.md](./ADMIN_SYSTEM_TECHNICAL_DESIGN.md) | 总体架构、技术选型、路由边界、数据源策略、模块功能、API 和部署 | 先读，理解整体方案 |
| [ADMIN_SYSTEM_DATABASE_SCHEMA.sql](./ADMIN_SYSTEM_DATABASE_SCHEMA.sql) | MySQL 表结构、索引、外键和约束 | 实现 Drizzle schema/migrations 时作为结构基线 |
| [ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md](./ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md) | P0-P9 阶段任务、验收和交付报告模板 | 拆分开发任务和追踪进度 |
| [ADMIN_SYSTEM_SECURITY_AND_TESTING.md](./ADMIN_SYSTEM_SECURITY_AND_TESTING.md) | 管理员认证、RBAC、CSRF、XSS、SQL、导入、回归和发布安全 | 开发及上线前检查 |
| [skills/admin-system-development/SKILL.md](./skills/admin-system-development/SKILL.md) | 面向本地 Qwen/Codex 等编码 Agent 的执行规则和分阶段 Skill | 复制给本地 Qwen 作为项目开发指令 |

## 推荐给本地 Qwen 的启动提示词

请先完整阅读以下文档：
1. `docs/skills/admin-system-development/SKILL.md`
2. `docs/ADMIN_SYSTEM_TECHNICAL_DESIGN.md`
3. `docs/ADMIN_SYSTEM_IMPLEMENTATION_PLAN.md`
4. `docs/ADMIN_SYSTEM_SECURITY_AND_TESTING.md`
5. `docs/ADMIN_SYSTEM_DATABASE_SCHEMA.sql`

然后只执行 P0（仓库审计与基线），不要直接开发后台。完成 P0 后，汇报路由清单、静态数据字典、数据计数与关系校验、现有代码风险、lint/typecheck/build 基线和待确认问题，等待确认后再执行 P1。必须遵守 Skill 中所有不可违反的约束，保留现有前台和全部静态快照。

## 其他项目文档

- `design-references/`：网站视觉参考截图。
- `assets/`：项目文档资源。
