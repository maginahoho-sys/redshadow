/**
 * index.ts —— 合同层统一出口（冻结）
 * 模块内 import 一律从本文件走，禁止深路径引用单个合同文件。
 */
export * from "./types";
export * from "./ecs";
export * from "./events";
export * from "./rng";
