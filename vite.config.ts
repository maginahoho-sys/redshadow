import { defineConfig } from "vite";

// Vite 配置：base 用相对路径，构建产物可直接本地打开或托管
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 4096
  }
});
