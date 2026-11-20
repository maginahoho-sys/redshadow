/**
 * M1 战斗结算 验收测试（src/systems/combat.ts）
 *
 * 运行：env -u NODE_OPTIONS npx vitest run tests/m1.test.ts
 */
import { describe, it, expect } from "vitest";
import { calcDamage, assignBlocking, combatSystem } from "../src/systems/combat";
import {
  makeBattleState, placeOperator, spawnEnemy, collectEvents,
  health, pos, tick
} from "./helpers";

describe("M1-公式 calcDamage", () => {
  it("物理伤害 = max(攻击-防御, 攻击×5%)", () => {
    expect(calcDamage(300, 100, 0, "physical")).toBe(200);
    expect(calcDamage(100, 300, 0, "physical")).toBe(5);
  });

  it("法术伤害 = 攻击×(1-法抗)，法抗夹紧 [0,100]，5% 下限", () => {
    expect(calcDamage(200, 500, 50, "arts")).toBe(100);
    expect(calcDamage(200, 0, 150, "arts")).toBe(10);
    expect(calcDamage(0, 100, 0, "physical")).toBe(0);
  });
});

describe("M1-阻挡 assignBlocking", () => {
  it("敌人进入干员格时被阻挡", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2);
    const en = spawnEnemy(s, { row: 2.3, col: 1.7 });
    const events = collectEvents(s.bus);
    assignBlocking(s);
    const path = s.world.get(s.world.query("enemyPath")[0], "enemyPath")!;
    expect(path.blockedBy).toBe(op);
    const block = s.world.get(op, "block")!;
    expect(block.blocked).toContain(en);
    expect(events.some(e => e.type === "enemyBlocked" && e.enemyId === en && e.blockerId === op)).toBe(true);
  });

  it("阻挡位满后不再阻挡", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2); // 挡 2
    const e1 = spawnEnemy(s, { row: 2.1, col: 2.1 });
    const e2 = spawnEnemy(s, { row: 2.2, col: 2.2 });
    const e3 = spawnEnemy(s, { row: 2.3, col: 2.3 });
    assignBlocking(s);
    const blocked = s.world.get(op, "block")!.blocked;
    expect(blocked.length).toBe(2);
    const p3 = s.world.get(e3, "enemyPath")!;
    expect(p3.blockedBy).toBe(-1);
    expect(blocked).toContain(e1);
    expect(blocked).toContain(e2);
  });
});

describe("M1-攻击 combatSystem", () => {
  it("攻击计时器累积满间隔后攻击一次并重置", () => {
    const s = makeBattleState();
    placeOperator(s, "op_guard_01", 2, 2); // atk 320, interval 1.3, range 含 [0,1]
    spawnEnemy(s, { row: 2, col: 3 });      // def 50, hp 550
    const events = collectEvents(s.bus);
    combatSystem(s, 0.7);
    combatSystem(s, 0.7); // 1.4s ≥ 1.3
    const en = s.world.query("enemyPath")[0];
    expect(health(s, en).hp).toBe(550 - (320 - 50)); // 280
    expect(events.filter(e => e.type === "attackLanded")).toHaveLength(1);
    combatSystem(s, 0.5); // 计时 0.6 < 1.3 不攻击
    expect(health(s, en).hp).toBe(280);
    combatSystem(s, 0.8); // 计时 1.4 → 攻击
    expect(health(s, en).hp).toBe(10);
    expect(events.filter(e => e.type === "attackLanded")).toHaveLength(2);
  });

  it("范围外不攻击", () => {
    const s = makeBattleState();
    placeOperator(s, "op_guard_01", 2, 2); // 只覆盖 (2,1)(2,2)(2,3)
    spawnEnemy(s, { row: 0, col: 6 });
    const events = collectEvents(s.bus);
    combatSystem(s, 3);
    const en = s.world.query("enemyPath")[0];
    expect(health(s, en).hp).toBe(health(s, en).maxHp);
    expect(events.filter(e => e.type === "attackLanded")).toHaveLength(0);
  });

  it("优先攻击被自己阻挡的敌人", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2);
    const a = spawnEnemy(s, { row: 2.1, col: 2.1 }); // 被阻挡
    const b = spawnEnemy(s, { row: 2, col: 3 });      // 范围内
    const pa = s.world.get(a, "enemyPath")!;
    pa.blockedBy = op;
    s.world.get(op, "block")!.blocked.push(a);
    combatSystem(s, 1.4);
    expect(health(s, a).hp).toBeLessThan(health(s, a).maxHp);
    expect(health(s, b).hp).toBe(health(s, b).maxHp);
  });

  it("被阻挡的敌人攻击阻挡者，未被阻挡的敌人不攻击", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2); // hp 1500, def 200
    const en = spawnEnemy(s, { enemyId: "en_soldier" }); // atk 200, interval 1.8
    const free = spawnEnemy(s, { enemyId: "en_soldier", row: 2, col: 3 });
    const p = s.world.get(en, "enemyPath")!;
    p.blockedBy = op;
    s.world.get(op, "block")!.blocked.push(en);
    combatSystem(s, 1.8);
    expect(health(s, op).hp).toBe(1500 - Math.max(200 - 200, 200 * 0.05)); // 下限 10 → 1490
    expect(health(s, free).hp).toBe(health(s, free).maxHp); // 未被阻挡的敌人不攻击
  });

  it("敌人死亡：移出世界、发出 entityDied、从阻挡列表清除", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2);
    const en = spawnEnemy(s, { hp: 100 });
    const p = s.world.get(en, "enemyPath")!;
    p.blockedBy = op;
    s.world.get(op, "block")!.blocked.push(en);
    const events = collectEvents(s.bus);
    combatSystem(s, 1.4); // 一击 270 ≥ 100
    expect(s.world.alive(en)).toBe(false);
    expect(events.some(e => e.type === "entityDied" && e.entityId === en && e.faction === "enemy")).toBe(true);
    expect(s.world.get(op, "block")!.blocked).not.toContain(en);
  });

  it("干员阵亡：解除其阻挡的敌人", () => {
    const s = makeBattleState();
    const op = placeOperator(s, "op_guard_01", 2, 2); // hp 1500
    const en = spawnEnemy(s, { enemyId: "en_soldier", hp: 50000 });
    s.world.get(en, "attack")!.atk = 2000; // 手动抬高攻击力，确保一击致命
    const p = s.world.get(en, "enemyPath")!;
    p.blockedBy = op;
    s.world.get(op, "block")!.blocked.push(en);
    const events = collectEvents(s.bus);
    combatSystem(s, 2.0); // 敌人一击 2000-200=1800 ≥ 1500
    expect(s.world.alive(op)).toBe(false);
    expect(events.some(e => e.type === "entityDied" && e.faction === "operator")).toBe(true);
    expect(s.world.get(en, "enemyPath")!.blockedBy).toBe(-1);
  });
});
