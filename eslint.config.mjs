import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 独立 Node 辅助脚本（素材管线 / DOM 检查），不属于应用代码
    "docs/**",
    "scripts/**",
    ".playwright-mcp/**",
    // 源站 vendored 代码（wangeditor 富文本，minified 整块移植），不参与应用代码检查
    "src/vendor/**",
  ]),
  // 像素级还原源站：源站全部使用原生 <img>，不适用 next/image 优化规则
  {
    files: ["src/components/sites/facai8/**/*.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
