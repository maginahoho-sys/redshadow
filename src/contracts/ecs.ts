/**
 * ecs.ts —— 轻量 ECS 核心（合同层，冻结）
 *
 * 设计取舍：本项目同屏实体 < 100，追求的是「组件化可组合」而非极限性能。
 * 实体 = 数字 id；组件按 key 存在稀疏 Map 里；query 按拥有全部给定 key 过滤。
 * 接口极简且永不变化，便于小模型按 SPEC 直接使用。
 *
 * 系统约定：System = (ctx) => void，ctx 由调用方组装（BattleState 等）。
 */

import type { ComponentKey, ComponentMap } from "./types";

/** 实体 id（正整数，0 为无效值） */
export type EntityId = number;

/** 系统函数：每帧 tick 调用 */
export type System<T> = (ctx: T, dt: number) => void;

/** 轻量 ECS World */
export interface World {
  /** 新建实体，返回 id */
  createEntity(): EntityId;
  /** 删除实体（幂等） */
  destroyEntity(id: EntityId): void;
  /** 实体是否存活 */
  alive(id: EntityId): boolean;
  /** 挂载组件（重复挂载覆盖旧值） */
  add<K extends ComponentKey>(id: EntityId, key: K, value: ComponentMap[K]): void;
  /** 读取组件（不存在返回 undefined） */
  get<K extends ComponentKey>(id: EntityId, key: K): ComponentMap[K] | undefined;
  /** 是否拥有某组件 */
  has(id: EntityId, key: ComponentKey): boolean;
  /** 移除单个组件 */
  remove(id: EntityId, key: ComponentKey): void;
  /** 返回同时拥有全部给定 key 的实体 id 列表（顺序按 id 升序） */
  query(...keys: ComponentKey[]): EntityId[];
  /** 返回拥有任一给定 key 的实体 id 列表（去重升序） */
  queryAny(...keys: ComponentKey[]): EntityId[];
  /** 当前存活实体总数 */
  count(): number;
}

/** 创建一个 World 实例 */
export function createWorld(): World {
  // 组件存储：key -> (entityId -> 组件数据)
  const stores = new Map<ComponentKey, Map<EntityId, object>>();
  // 存活实体集合
  const aliveSet = new Set<EntityId>();
  let nextId: EntityId = 1;

  function storeOf(key: ComponentKey): Map<EntityId, object> {
    let s = stores.get(key);
    if (!s) {
      s = new Map();
      stores.set(key, s);
    }
    return s;
  }

  const world: World = {
    createEntity() {
      const id = nextId++;
      aliveSet.add(id);
      return id;
    },

    destroyEntity(id) {
      if (!aliveSet.has(id)) return;
      aliveSet.delete(id);
      for (const s of stores.values()) s.delete(id);
    },

    alive(id) {
      return aliveSet.has(id);
    },

    add(id, key, value) {
      if (!aliveSet.has(id)) {
        throw new Error(`ecs: 实体 ${id} 不存在，无法挂载组件 ${key}`);
      }
      storeOf(key).set(id, value);
    },

    get(id, key) {
      return storeOf(key).get(id) as ComponentMap[typeof key] | undefined;
    },

    has(id, key) {
      return storeOf(key).has(id);
    },

    remove(id, key) {
      storeOf(key).delete(id);
    },

    query(...keys) {
      if (keys.length === 0) {
        return [...aliveSet].sort((a, b) => a - b);
      }
      // 从最稀疏的 key 开始交集，减少遍历量
      const sorted = keys.map(storeOf).sort((a, b) => a.size - b.size);
      const first = sorted[0];
      const result: EntityId[] = [];
      for (const id of first.keys()) {
        if (!aliveSet.has(id)) continue;
        let ok = true;
        for (let i = 1; i < sorted.length; i++) {
          if (!sorted[i].has(id)) {
            ok = false;
            break;
          }
        }
        if (ok) result.push(id);
      }
      result.sort((a, b) => a - b);
      return result;
    },

    queryAny(...keys) {
      const set = new Set<EntityId>();
      for (const key of keys) {
        for (const id of storeOf(key).keys()) {
          if (aliveSet.has(id)) set.add(id);
        }
      }
      return [...set].sort((a, b) => a - b);
    },

    count() {
      return aliveSet.size;
    }
  };

  return world;
}
