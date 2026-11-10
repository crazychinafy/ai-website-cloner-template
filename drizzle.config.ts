import { defineConfig } from "drizzle-kit"

// P1：Drizzle 初始化。
// - schema 当前为占位（P2 映射 DDL 到 ./src/lib/db/schema/**）
// - migration 文件生成到 ./drizzle 并纳入 Git；应用启动从不自动执行 migration（SKILL 约束 9）
// - dbCredentials 仅 drizzle-kit push/introspect 使用；应用自身连接走 src/lib/db/client.ts
export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      `mysql://${process.env.DB_USER ?? "facai8_app"}:${process.env.DB_PASSWORD ?? ""}@${process.env.DB_HOST ?? "127.0.0.1"}:${process.env.DB_PORT ?? "3306"}/${process.env.DB_NAME ?? "facai8_admin"}`,
  },
})
