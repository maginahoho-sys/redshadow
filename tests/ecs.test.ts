import { describe, it, expect } from "vitest";
import { createWorld } from "../src/contracts/ecs";
import { createBus } from "../src/contracts/events";
import { createRng } from "../src/contracts/rng";
import type { GameEvent } from "../src/contracts/types";

/**
 * 合同层单测：ECS / 事件总线 / 种子随机数。
 * 这些测试保证"合同"本身正确，永远有效。
 */

describe("ecs.createWorld", () => {
  it("创建实体返回递增的 id", () => {
    const w = createWorld();
    const a = w.createEntity();
    const b = w.createEntity();
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a + 1);
  });

  it("add / get / has / remove 组件", () => {
    const w = createWorld();
    const e = w.createEntity();
    w.add(e, "identity", { defId: "op_x", faction: "operator", name: "x" });
    expect(w.has(e, "identity")).toBe(true);
    expect(w.get(e, "identity")).toEqual({ defId: "op_x", faction: "operator", name: "x" });
    w.remove(e, "identity");
    expect(w.has(e, "identity")).toBe(false);
    expect(w.get(e, "identity")).toBeUndefined();
  });

  it("重复 add 覆盖旧组件", () => {
    const w = createWorld();
    const e = w.createEntity();
    w.add(e, "health", { hp: 10, maxHp: 10 });
    w.add(e, "health", { hp: 7, maxHp: 10 });
    expect(w.get(e, "health")).toEqual({ hp: 7, maxHp: 10 });
  });

  it("destroyEntity 清空组件且幂等", () => {
    const w = createWorld();
    const e = w.createEntity();
    w.add(e, "health", { hp: 1, maxHp: 1 });
    w.destroyEntity(e);
    expect(w.alive(e)).toBe(false);
    expect(w.get(e, "health")).toBeUndefined();
    expect(() => w.destroyEntity(e)).not.toThrow();
    expect(() => w.add(e, "health", { hp: 1, maxHp: 1 })).toThrow();
  });

  it("query 返回同时拥有全部组件的实体（升序）", () => {
    const w = createWorld();
    const e1 = w.createEntity();
    const e2 = w.createEntity();
    const e3 = w.createEntity();
    const atk = { atk: 1, def: 0, res: 0, damageType: "physical" as const, interval: 1, timer: 0, targetLimit: 1 };
    w.add(e1, "health", { hp: 1, maxHp: 1 });
    w.add(e2, "health", { hp: 1, maxHp: 1 });
    w.add(e3, "health", { hp: 1, maxHp: 1 });
    w.add(e1, "attack", atk);
    w.add(e2, "attack", atk);
    w.add(e1, "block", { capacity: 1, blocked: [] });
    expect(w.query("health", "attack")).toEqual([e1, e2]);
    expect(w.query("health", "attack", "block")).toEqual([e1]);
    expect(w.query("health")).toEqual([e1, e2, e3]);
  });

  it("无参数 query 返回全部实体", () => {
    const w = createWorld();
    const e1 = w.createEntity();
    const e2 = w.createEntity();
    expect(w.query()).toEqual([e1, e2]);
    expect(w.count()).toBe(2);
  });

  it("queryAny 返回并集（升序去重）", () => {
    const w = createWorld();
    const e1 = w.createEntity();
    const e2 = w.createEntity();
    const e3 = w.createEntity();
    w.add(e1, "health", { hp: 1, maxHp: 1 });
    w.add(e2, "attack", { atk: 1, def: 0, res: 0, damageType: "physical" as const, interval: 1, timer: 0, targetLimit: 1 });
    w.add(e3, "identity", { defId: "x", faction: "enemy", name: "x" });
    expect(w.queryAny("health", "attack")).toEqual([e1, e2]);
    expect(w.queryAny("health", "identity")).toEqual([e1, e3]);
  });

  it("对已销毁实体 query 不再返回", () => {
    const w = createWorld();
    const e1 = w.createEntity();
    w.add(e1, "health", { hp: 1, maxHp: 1 });
    const e2 = w.createEntity();
    w.add(e2, "health", { hp: 1, maxHp: 1 });
    w.destroyEntity(e1);
    expect(w.query("health")).toEqual([e2]);
  });
});

describe("events.createBus", () => {
  it("on 订阅 / emit 派发 / 类型收窄", () => {
    const bus = createBus<GameEvent>();
    const got: GameEvent[] = [];
    bus.on("attackLanded", e => {
      // e 此处收窄为 attackLanded 载荷
      got.push(e);
    });
    bus.emit({ type: "attackLanded", attacker: 1, target: 2, damage: 30, damageType: "physical" });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ attacker: 1, target: 2, damage: 30 });
  });

  it("取消订阅后不再收到事件", () => {
    const bus = createBus<GameEvent>();
    let n = 0;
    const off = bus.on("entityDied", () => n++);
    bus.emit({ type: "entityDied", entityId: 3, faction: "enemy" });
    off();
    bus.emit({ type: "entityDied", entityId: 4, faction: "enemy" });
    expect(n).toBe(1);
  });

  it("clear 清空所有订阅", () => {
    const bus = createBus<GameEvent>();
    let n = 0;
    bus.on("entityDied", () => n++);
    bus.clear();
    bus.emit({ type: "entityDied", entityId: 3, faction: "enemy" });
    expect(n).toBe(0);
  });

  it("handler 内取消其他订阅不崩溃", () => {
    const bus = createBus<GameEvent>();
    const off2 = bus.on("entityDied", () => { /* noop */ });
    let ok = false;
    bus.on("entityDied", () => {
      off2();
      ok = true;
    });
    bus.emit({ type: "entityDied", entityId: 1, faction: "enemy" });
    expect(ok).toBe(true);
  });
});

describe("rng.createRng", () => {
  it("同一 seed 序列完全一致", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it("不同 seed 序列不同", () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = [a.next(), a.next(), a.next()];
    const sb = [b.next(), b.next(), b.next()];
    expect(sa).not.toEqual(sb);
  });

  it("next 输出在 [0,1)", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int 在闭区间内且边可达", () => {
    const r = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = r.int(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it("weighted 按权重挑选", () => {
    const r = createRng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weighted([100, 0, 0])]++;
    expect(counts[0]).toBe(6000);
    expect(counts[1]).toBe(0);
    // 零权重不被选中
    expect(() => r.weighted([0, 0])).toThrow();
    expect(() => r.weighted([])).toThrow();
  });

  it("pick / shuffle / chance", () => {
    const r = createRng(11);
    expect(r.pick([7])).toBe(7);
    expect(() => r.pick([])).toThrow();
    const arr = [1, 2, 3, 4, 5];
    r.shuffle(arr);
    expect([...arr].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.chance(1)).toBe(true);
    expect(r.chance(0)).toBe(false);
  });

  it("state 可用于断点记录", () => {
    const r = createRng(42);
    r.next(); r.next();
    expect(r.state()).toBeGreaterThan(0);
  });
});
