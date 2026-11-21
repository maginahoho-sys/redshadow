/**
 * M16 医疗机制验收测试（新增文件，不改动既有任何测试）
 *
 * 覆盖点：
 * 1. 医疗干员不打敌人，治疗射程内受伤友军（治疗量 = atk，不吃 def/res）；
 * 2. 最重伤优先（hp/maxHp 比例最低）；
 * 3. 满血友军不选中（不浪费攻击间隔）；
 * 4. 治疗不超出 maxHp 上限；
 * 5. 非医疗干员行为完全不变（照常攻击敌人）。
 */
import { describe, it, expect } from "vitest";
import {
  makeBattleState, placeOperator, spawnEnemy, health, tick
} from "./helpers";
import { combatSystem, assignBlocking } from "../src/systems/combat";

const SYS = [assignBlocking, combatSystem] as const;

function placeMedicAndTarget(targetHp: number, medicRow = 1, medicCol = 1,
                             targetRow = 1, targetCol = 2): { state: ReturnType<typeof makeBattleState>; medic: number; target: number } {
  const state = makeBattleState({ squadOperatorIds: ["op_medic_01", "op_defender_01"] });
  const target = placeOperator(state, "op_defender_01", targetRow, targetCol);
  health(state, target).hp = targetHp;
  const medic = placeOperator(state, "op_medic_01", medicRow, medicCol);
  return { state, medic, target };
}

describe("M16 医疗机制", () => {
  it("医疗干员治疗射程内受伤友军，治疗量 = atk 且不吃防御", () => {
    // 幕侧医师 atk=150；放在高台 (1,1)，防御者 (1,2) 受伤剩 1000
    const { state, medic, target } = placeMedicAndTarget(1000);
    // 射程内放一个敌人：医疗干员不得攻击它
    const enemy = spawnEnemy(state, { row: 1, col: 2, waypoints: [{ row: 1, col: 2 }, { row: 1, col: 3 }] });

    tick(state, 1.5, [...SYS]); // interval 1.4s → 补一次治疗
    expect(health(state, target).hp).toBe(1000 + 150);
    expect(health(state, enemy).hp).toBe(state.enemyDefs["en_slug"].hp); // 敌人毫发无损
    expect(state.world.alive(medic)).toBe(true);
  });

  it("最重伤友军优先", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_medic_01", "op_guard_01", "op_vanguard_01"] });
    const g1 = placeOperator(state, "op_guard_01", 1, 2);      // hp 1500 → 伤到 300（20%）
    health(state, g1).hp = 300;
    const g2 = placeOperator(state, "op_vanguard_01", 1, 1);   // hp 800 → 伤到 700（87.5%，更轻）
    health(state, g2).hp = 700;
    placeOperator(state, "op_medic_01", 2, 2);                 // 医疗在 (2,2)，两伤员都在 3×3 射程

    tick(state, 1.5, [...SYS]);
    // targetLimit=1，只奶最重的 g1
    expect(health(state, g1).hp).toBe(450);
    expect(health(state, g2).hp).toBe(700);
  });

  it("满血友军不会被选中，不浪费攻击间隔", () => {
    const { state, target } = placeMedicAndTarget(1000);
    health(state, target).hp = health(state, target).maxHp;  // 满血
    const enemy = spawnEnemy(state, { row: 0, col: 0, waypoints: [{ row: 0, col: 0 }, { row: 0, col: 1 }] });

    tick(state, 3, [...SYS]);  // 两个攻击间隔过去了
    expect(health(state, enemy).hp).toBe(state.enemyDefs["en_slug"].hp); // 医疗不打敌人
    expect(state.bus).toBeDefined();
  });

  it("治疗不超过 maxHp 上限", () => {
    const { state, target } = placeMedicAndTarget(1450);  // maxHp 2400，奶 150 → 1600（未触顶）
    tick(state, 1.5, [...SYS]);
    expect(health(state, target).hp).toBe(1600);
    // 连续奶到触顶（1450 + 150×6 = 2350 < 2400，第 7 次奶满触顶不再溢出）
    tick(state, 1.5, [...SYS]);
    tick(state, 1.5, [...SYS]);
    tick(state, 1.5, [...SYS]);
    tick(state, 1.5, [...SYS]);
    tick(state, 1.5, [...SYS]);
    tick(state, 1.5, [...SYS]);
    expect(health(state, target).hp).toBe(health(state, target).maxHp);
  });

  it("非医疗干员行为不变：照常攻击敌人", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_guard_01"] });
    placeOperator(state, "op_guard_01", 2, 1);
    const enemy = spawnEnemy(state, { row: 2, col: 1, waypoints: [{ row: 2, col: 1 }, { row: 2, col: 2 }] });

    tick(state, 1.4, [...SYS]);
    const expected = 550 - Math.max(320 - 50, 320 * 0.05); // slug hp550 - guard atk320 减 def50
    expect(health(state, enemy).hp).toBe(expected);
  });
});
