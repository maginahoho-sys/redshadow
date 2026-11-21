/**
 * M4 收藏品词条结算 验收测试（src/systems/relics.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "./helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m4.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  matches, buildOperatorEffective, buildEnemyDefs, buildGlobals, runStartFrom
} from "../src/systems/relics";
import type { RelicDef, RelicMod, OperatorDef, EnemyDef, EffectiveGlobals } from "../src/contracts";
import {
  OPERATOR_DEFS, ENEMY_DEFS, RUN_CONFIG
} from "./helpers";
import relicsJson from "../src/data/relics.json";

const RELICS: Record<string, RelicDef> = Object.fromEntries(
  (relicsJson as RelicDef[]).map(r => [r.id, r])
);
const MODS = (ids: string[]): RelicMod[] =>
  ids.flatMap(id => RELICS[id].mods);

describe("M4 matches 选择器", () => {
  const sniper = { faction: "operator" as const, profession: "sniper" as const, tags: ["ranged", "sniper"] };
  const guard = { faction: "operator" as const, profession: "guard" as const, tags: ["melee", "guard"] };
  const slug = { faction: "enemy" as const, tags: ["weak"] };

  it("按阵营过滤", () => {
    expect(matches({ faction: "operator" }, sniper)).toBe(true);
    expect(matches({ faction: "enemy" }, sniper)).toBe(false);
    expect(matches({}, slug)).toBe(true); // 不填 = 双方
  });

  it("按职业过滤", () => {
    expect(matches({ professions: ["guard"] }, guard)).toBe(true);
    expect(matches({ professions: ["guard"] }, sniper)).toBe(false);
  });

  it("按标签过滤（全部满足 / 任一满足）", () => {
    expect(matches({ tagsAll: ["ranged"] }, sniper)).toBe(true);
    expect(matches({ tagsAll: ["ranged", "melee"] }, sniper)).toBe(false);
    expect(matches({ tagsAny: ["vanguard", "ranged"] }, sniper)).toBe(true);
    expect(matches({ tagsAny: ["vanguard"] }, sniper)).toBe(false);
  });

  it("组合条件取交集", () => {
    expect(matches({ faction: "operator", professions: ["sniper"], tagsAll: ["ranged"] }, sniper)).toBe(true);
    expect(matches({ faction: "operator", professions: ["guard"], tagsAll: ["ranged"] }, sniper)).toBe(false);
  });
});

describe("M4 buildOperatorEffective 干员有效属性", () => {
  const defs = Object.values(OPERATOR_DEFS);

  it("无词条时等于基准值", () => {
    const eff = buildOperatorEffective(defs, []);
    expect(eff["op_guard_01"].atk).toBe(320);
    expect(eff["op_sniper_01"].cost).toBe(11);
  });

  it("收藏品词条正确命中（职业选择器 + 负面词条）", () => {
    const eff = buildOperatorEffective(defs, MODS(["rl_blood_blade", "rl_cursed_coin"]));
    expect(eff["op_guard_01"].atk).toBe(320 * 1.2);    // 近卫攻击 +20%
    expect(eff["op_sniper_01"].atk).toBe(260);          // 狙击不受"染血新月"影响
    expect(eff["op_vanguard_01"].cost).toBe(10 + 2);   // 全员费用 +2
  });

  it("先汇总所有 add 再应用 mul", () => {
    const mods: RelicMod[] = [
      { kind: "stat", selector: { faction: "operator", professions: ["guard"] }, stat: "atk", op: "add", value: 100 },
      { kind: "stat", selector: { faction: "operator", professions: ["guard"] }, stat: "atk", op: "mul", value: 1.2 }
    ];
    const eff = buildOperatorEffective(defs, mods);
    expect(eff["op_guard_01"].atk).toBe((320 + 100) * 1.2); // 504
  });

  it("grantTag 追加标签，未命中不受影响", () => {
    const mods: RelicMod[] = [
      { kind: "grantTag", selector: { tagsAll: ["ranged"] }, tag: "blessed" }
    ];
    const eff = buildOperatorEffective(defs, mods);
    expect(eff["op_sniper_01"].tags).toContain("blessed");
    expect(eff["op_guard_01"].tags).not.toContain("blessed");
  });
});

describe("M4 buildEnemyDefs 敌人有效属性", () => {
  it("词条修改敌人属性且不改动原始定义", () => {
    const base = Object.values(ENEMY_DEFS);
    const result = buildEnemyDefs(base, MODS(["rl_dull_mask"]));
    const slug = result["en_slug"];
    expect(slug.hp).toBe(550 * 0.9);
    expect(slug.id).toBe("en_slug");
    expect(ENEMY_DEFS["en_slug"].hp).toBe(550); // 原定义未被改动
  });

  it("无词条时返回等值克隆", () => {
    const result = buildEnemyDefs(Object.values(ENEMY_DEFS), []);
    expect(result["en_soldier"].hp).toBe(1000);
    expect(result["en_soldier"]).not.toBe(ENEMY_DEFS["en_soldier"]); // 必须是克隆
  });
});

describe("M4 buildGlobals 战斗全局参数", () => {
  it("全局词条求值，未知词条忽略", () => {
    const base: EffectiveGlobals = { dpRate: 0.8, initialDp: 10, objectiveHp: 3, tempObjectiveHp: 0, squadSize: 4 };
    const g = buildGlobals(base, MODS(["rl_wine_cup"]));
    expect(g.dpRate).toBeCloseTo(0.96, 6);
    expect(g.objectiveHp).toBe(3);
  });

  it("tempObjectiveHp 与 squadSize 词条", () => {
    const base = { dpRate: 0.8, initialDp: 10, objectiveHp: 3, tempObjectiveHp: 0, squadSize: 4 };
    const teamCommand = RUN_CONFIG.teams.find(t => t.id === "team_command")!;
    const g = buildGlobals(base, teamCommand.mods as RelicMod[]);
    expect(g.tempObjectiveHp).toBe(4);
    const teamCluster = RUN_CONFIG.teams.find(t => t.id === "team_cluster")!;
    const g2 = buildGlobals(base, teamCluster.mods as RelicMod[]);
    expect(g2.squadSize).toBe(6);
  });
});

describe("M4 runStartFrom 探索局初始资源", () => {
  it("分队 runStat 词条生效，非 runStat 词条忽略", () => {
    const logistics = RUN_CONFIG.teams.find(t => t.id === "team_logistics")!;
    const start = runStartFrom(RUN_CONFIG.runStart, logistics.mods as RelicMod[]);
    expect(start.ingots).toBe(RUN_CONFIG.runStart.ingots + 20);
    expect(start.hope).toBe(RUN_CONFIG.runStart.hope + 2);
    expect(start.objectiveHp).toBe(RUN_CONFIG.runStart.objectiveHp);
  });

  it("mul 与 add 同时支持", () => {
    const mods: RelicMod[] = [
      { kind: "runStat", target: "ingots", op: "mul", value: 2 },
      { kind: "runStat", target: "hope", op: "add", value: 3 }
    ];
    const start = runStartFrom(RUN_CONFIG.runStart, mods);
    expect(start.ingots).toBe(RUN_CONFIG.runStart.ingots * 2);
    expect(start.hope).toBe(RUN_CONFIG.runStart.hope + 3);
  });
});
