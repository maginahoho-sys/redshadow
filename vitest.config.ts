import { defineConfig } from "vitest/config";

// 单测配置：只收集 tests/ 顶层的 *.test.ts
// tests/pending/ 下的验收用例在对应模块交付前不参与运行
export default defineConfig({
  test: {
    include: ["tests/*.test.ts"],
    environment: "node"
  }
});
