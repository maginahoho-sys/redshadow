/**
 * M2 敌人寻路移动 验收测试（src/systems/movement.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "../helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m2.test.ts
 */
import { describe, it, expect } from "vitest";
import { movementSystem } from "../../src/systems/movement";
import {
  makeBattleState, spawnEnemy, collectEvents, pos
} from "../helpers";

describe("M2 movementSystem", () => {
  it("沿路点直线移动（0.5 格/秒）", () => {
    const s = makeBattleState();
    const en = spawnEnemy(s); // en_slug speed 0.5，路线 (2,0)→(2,6)
    movementSystem(s, 1);
    movementSystem(s, 1);
    expect(pos(s, en).col).toBeCloseTo(1.0, 5);
    expect(pos(s, en).row).toBe(2);
  });

  it("先对齐行再对齐列（先纵向后横向）", () => {
    const s = makeBattleState();
    const en = spawnEnemy(s, {
      waypoints: [
        { row: 2, col: 0 },
        { row: 4, col: 0 },
        { row: 4, col: 5 }
      ]
    });
    movementSystem(s, 2); // 移动 1 格 → 向下
    expect(pos(s, en).row).toBe(3);
    expect(pos(s, en).col).toBe(0);
    movementSystem(s, 4); // 再 2 格：到 (4,0) 后开始向右
    expect(pos(s, en).row).toBe(4);
    expect(pos(s, en).col).toBe(1);
  });

  it("大步长不跳过路点（每段逐次推进）", () => {
    const s = makeBattleState();
    const en = spawnEnemy(s, {
      waypoints: [
        { row: 2, col: 0 },
        { row: 4, col: 0 },
        { row: 4, col: 5 }
      ]
    });
    movementSystem(s, 10); // 共可走 5 格：下 2 + 右 3
    expect(pos(s, en).row).toBe(4);
    expect(pos(s, en).col).toBe(3);
  });

  it("被阻挡时停止移动", () => {
    const s = makeBattleState();
    const en = spawnEnemy(s);
    const p = s.world.get(en, "enemyPath")!;
    p.blockedBy = 99;
    movementSystem(s, 3);
    expect(pos(s, en).col).toBe(0);
    expect(pos(s, en).row).toBe(2);
  });

  it("到达终点：敌人移除、扣目标生命、发出 enemyLeaked", () => {
    const s = makeBattleState({ objectiveHp: 3 });
    const en = spawnEnemy(s, { row: 2, col: 5.9 }); // 距终点 0.1 格
    const events = collectEvents(s.bus);
    movementSystem(s, 10); // 足够走到终点
    expect(s.world.alive(en)).toBe(false);
    expect(s.objectiveHp).toBe(3 - 1); // leakDamage 1
    expect(events.some(e => e.type === "enemyLeaked" && e.entityId === en && e.leakDamage === 1)).toBe(true);
  });

  it("恰好停在终点格不漏（须实际越过最后一个路点才漏）", () => {
    const s = makeBattleState({ objectiveHp: 3 });
    const en = spawnEnemy(s, { row: 2, col: 5.5 });
    movementSystem(s, 0.9); // 0.45 格 → 到 5.95，未到 6
    expect(s.world.alive(en)).toBe(true);
    movementSystem(s, 0.2); // 到 6.05 → 越过终点
    expect(s.world.alive(en)).toBe(false);
    expect(s.objectiveHp).toBe(2);
  });
});
