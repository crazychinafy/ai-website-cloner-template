import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// P2 管理后台测试配置：
// - server-only 打桩为空模块（vitest 运行在 Node，不走 Next 的 react-server 条件）
// - 串行执行（多个测试文件共享同一 scratch 数据库名，必须互斥）
// - 超时放宽（真实 MySQL 建库/迁移/argon2 哈希均为秒级操作）
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/admin/stubs/server-only.ts", import.meta.url)),
      // Next.js 的 @/ 路径别名（client.ts 等 src 内模块使用）
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // vitest 5：单 worker 串行执行（多个测试文件共享同一 scratch 数据库名，必须互斥）
    maxWorkers: 1,
    include: ["test/admin/**/*.test.ts", "test/admin/**/*.test.tsx"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
})
