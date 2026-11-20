/**
 * M5 波次与胜负 验收测试（src/systems/waves.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "../helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m5.test.ts
 */
import { describe, it, expect } from "vitest";
import { waveSystem, checkBattleEnd } from "../../src/systems/waves";
import {
  makeBattleState, collectEvents, enemyIds, STAGE
} from "../helpers";

/** 把战斗时间推进 total 秒，每步 step 秒执行 waveSystem */
function runWaves(s: ReturnType<typeof makeBattleState>, total: number, step = 0.5): void {
  for (let t = 0; t < total; t += step) {
    s.time += step;
    waveSystem(s, step);
  }
}

describe("M5 waveSystem 波次调度", () => {
  it("首波在 delay 后开始，事件与待出生队列正确", () => {
    const s = makeBattleState();
    const events = collectEvents(s.bus);
    runWaves(s, 1.9);
    expect(s.waveIndex).toBe(0);
    expect(events.filter(e => e.type === "waveStarted")).toHaveLength(0);
    runWaves(s, 0.2); // t = 2.1 ≥ 2
    expect(s.waveIndex).toBe(1); // 波 0 已开始
    expect(events.filter(e => e.type === "waveStarted")).toEqual([
      expect.objectContaining({ type: "waveStarted", index: 0 })
    ]);
    // 波 0：3 只蛞蝓，delay 0，interval 2 → 待出生时间 2 / 4 / 6
    expect(s.pendingSpawns.map(p => p.at)).toEqual([2, 4, 6]);
  });

  it("敌人按时间点出生并进入世界", () => {
    const s = makeBattleState();
    const events = collectEvents(s.bus);
    runWaves(s, 2.1);
    expect(enemyIds(s)).toHaveLength(1);
    expect(events.filter(e => e.type === "enemySpawned")).toHaveLength(1);
    runWaves(s, 4); // t = 6.1，第二、三只都已到点
    expect(enemyIds(s)).toHaveLength(3);
  });

  it("clear 触发型波次：清空后延迟开始", () => {
    const s = makeBattleState();
    const events = collectEvents(s.bus);
    runWaves(s, 7); // 波 0 全部出生（3 只在场）
    for (const id of enemyIds(s)) s.world.destroyEntity(id); // 清场
    runWaves(s, 4.9);
    expect(s.waveIndex).toBe(1); // 尚未开始波 1（clear 后需 5 秒）
    expect(events.filter(e => e.type === "waveStarted")).toHaveLength(1);
    runWaves(s, 0.2); // 满 5 秒
    expect(s.waveIndex).toBe(2);
    expect(events.filter(e => e.type === "waveStarted")).toHaveLength(2);
  });

  it("波 1 的多条目调度正确", () => {
    const s = makeBattleState();
    runWaves(s, 7);
    for (const id of enemyIds(s)) s.world.destroyEntity(id);
    runWaves(s, 5.1); // 波 1 开始（清场后 5 秒）
    expect(s.waveIndex).toBe(2);
    // 波 1 条目：soldier ×2（interval 3，delay 0）+ runner ×2（interval 1.5，delay 6）
    const spawnedIds = enemyIds(s).map(id => s.world.get(id, "identity")!.defId);
    const pending = s.pendingSpawns.map(p => p.enemyId);
    const all = [...spawnedIds, ...pending];
    expect(all.filter(x => x === "en_soldier").length).toBe(2);
    expect(all.filter(x => x === "en_runner").length).toBe(2);
    expect(spawnedIds).toContain("en_soldier"); // delay 0 的第一只当场出生
  });
});

describe("M5 checkBattleEnd 胜负判定", () => {
  it("目标生命归零判负，只发一次 battleEnded", () => {
    const s = makeBattleState({ objectiveHp: 1 });
    const events = collectEvents(s.bus);
    s.objectiveHp = 0;
    checkBattleEnd(s);
    expect(s.status).toBe("lost");
    expect(events.filter(e => e.type === "battleEnded")).toEqual([
      { type: "battleEnded", result: "lost" }
    ]);
    checkBattleEnd(s);
    expect(events.filter(e => e.type === "battleEnded")).toHaveLength(1);
  });

  it("所有波次结束且场上无敌人时判胜", () => {
    const s = makeBattleState();
    runWaves(s, 20); // 两波都会开始（波 1 clear 触发：清场在测试里直接销毁）
    expect(s.waveIndex).toBeLessThanOrEqual(STAGE.waves.length);
    // 手动清场并推进到全部出生
    for (const id of enemyIds(s)) s.world.destroyEntity(id);
    s.pendingSpawns = [];
    s.waveIndex = STAGE.waves.length;
    const events = collectEvents(s.bus);
    checkBattleEnd(s);
    expect(s.status).toBe("won");
    expect(events.filter(e => e.type === "battleEnded")).toEqual([
      { type: "battleEnded", result: "won" }
    ]);
  });

  it("场上仍有敌人或待出生队列时不判胜", () => {
    const s = makeBattleState();
    runWaves(s, 3); // 一只敌人已出生
    s.waveIndex = STAGE.waves.length;
    checkBattleEnd(s);
    expect(s.status).toBe("running");
  });

  it("已结束的战斗不再被检查", () => {
    const s = makeBattleState({ objectiveHp: 0 });
    s.status = "lost";
    const events = collectEvents(s.bus);
    checkBattleEnd(s);
    expect(events.filter(e => e.type === "battleEnded")).toHaveLength(0);
  });
});
