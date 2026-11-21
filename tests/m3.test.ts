/**
 * M3 部署与费用 验收测试（src/systems/deployment.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "./helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m3.test.ts
 */
import { describe, it, expect } from "vitest";
import { canDeploy, deployOperator, retreatOperator, deploymentSystem } from "../src/systems/deployment";
import { makeBattleState, placeOperator, spawnEnemy, collectEvents } from "./helpers";

describe("M3 canDeploy 合法性", () => {
  it("近战只能部署在地面道路", () => {
    const s = makeBattleState({ squadOperatorIds: ["op_guard_01"] });
    expect(canDeploy(s, "op_guard_01", { row: 2, col: 1 }).ok).toBe(true);  // 'r'
    expect(canDeploy(s, "op_guard_01", { row: 1, col: 1 }).ok).toBe(false); // 'h'
  });

  it("远程只能部署在高台", () => {
    const s = makeBattleState({ squadOperatorIds: ["op_sniper_01"] });
    expect(canDeploy(s, "op_sniper_01", { row: 1, col: 1 }).ok).toBe(true);
    expect(canDeploy(s, "op_sniper_01", { row: 2, col: 1 }).ok).toBe(false);
  });

  it("出生点、防御点不可部署", () => {
    const s = makeBattleState({ squadOperatorIds: ["op_guard_01"] });
    expect(canDeploy(s, "op_guard_01", { row: 2, col: 0 }).ok).toBe(false); // S
    expect(canDeploy(s, "op_guard_01", { row: 2, col: 6 }).ok).toBe(false); // G
  });

  it("被占据的格子不可部署", () => {
    const s = makeBattleState({ squadOperatorIds: ["op_guard_01", "op_vanguard_01"] });
    placeOperator(s, "op_guard_01", 2, 1);
    expect(canDeploy(s, "op_vanguard_01", { row: 2, col: 1 }).ok).toBe(false);
  });

  it("费用不足 / 冷却中 / 非队伍成员 不可部署", () => {
    const s = makeBattleState({ dp: 5, squadOperatorIds: ["op_guard_01", "op_sniper_01"] }); // guard 费用 14
    expect(canDeploy(s, "op_guard_01", { row: 2, col: 1 }).ok).toBe(false); // 费用不足
    const member = s.squad.find(m => m.operatorId === "op_sniper_01")!;
    member.state = "cooldown";
    member.cooldownRemaining = 30;
    expect(canDeploy(s, "op_sniper_01", { row: 1, col: 1 }).ok).toBe(false); // 冷却
    expect(canDeploy(s, "op_none_exist", { row: 2, col: 2 }).ok).toBe(false); // 不在队伍
  });
});

describe("M3 deployOperator / retreatOperator", () => {
  it("部署成功：扣费、实体就位、事件发出", () => {
    const s = makeBattleState({ dp: 20, squadOperatorIds: ["op_guard_01"] });
    const events = collectEvents(s.bus);
    const id = deployOperator(s, "op_guard_01", { row: 2, col: 2 });
    expect(id).toBeGreaterThan(0);
    expect(s.dp).toBe(20 - 14);
    const member = s.squad.find(m => m.operatorId === "op_guard_01")!;
    expect(member.state).toBe("deployed");
    expect(member.entityId).toBe(id);
    expect(s.world.alive(id)).toBe(true);
    expect(s.world.get(id, "block")!.capacity).toBe(2);
    expect(events.some(e => e.type === "operatorDeployed" && e.operatorId === "op_guard_01")).toBe(true);
  });

  it("非法部署返回 -1 且不产生任何变化", () => {
    const s = makeBattleState({ dp: 20, squadOperatorIds: ["op_guard_01"] });
    const id = deployOperator(s, "op_guard_01", { row: 1, col: 1 }); // 高台，非法
    expect(id).toBe(-1);
    expect(s.dp).toBe(20);
    expect(s.squad[0].state).toBe("ready");
    expect(s.world.count()).toBe(0);
  });

  it("撤退：全额退费、进入冷却、实体移除、解除阻挡", () => {
    const s = makeBattleState({ dp: 20, squadOperatorIds: ["op_guard_01"] });
    const id = deployOperator(s, "op_guard_01", { row: 2, col: 2 });
    const en = spawnEnemy(s, { row: 2.1, col: 2.1 });
    s.world.get(en, "enemyPath")!.blockedBy = id;
    const events = collectEvents(s.bus);
    expect(retreatOperator(s, "op_guard_01")).toBe(true);
    expect(s.dp).toBe(20); // 全额退费
    const member = s.squad.find(m => m.operatorId === "op_guard_01")!;
    expect(member.state).toBe("cooldown");
    expect(member.cooldownRemaining).toBe(70); // redeployCooldown
    expect(s.world.alive(id)).toBe(false);
    expect(s.world.get(en, "enemyPath")!.blockedBy).toBe(-1);
    expect(events.some(e => e.type === "operatorRetreated" && e.operatorId === "op_guard_01")).toBe(true);
  });
});

describe("M3 deploymentSystem 帧更新", () => {
  it("费用按 dpRate 自然回复", () => {
    const s = makeBattleState({ dp: 0 });
    for (let i = 0; i < 5; i++) deploymentSystem(s, 1);
    expect(s.dp).toBeCloseTo(4, 5); // 0.8/s × 5
  });

  it("部署先锋后费用回复提升 dpBonusRate", () => {
    const s = makeBattleState({ dp: 20, squadOperatorIds: ["op_vanguard_01"] });
    deployOperator(s, "op_vanguard_01", { row: 2, col: 1 }); // 费 10，剩 10
    deploymentSystem(s, 1);
    expect(s.dp).toBeCloseTo(10 + 0.8 + 0.05, 5);
  });

  it("冷却倒计时归零后回到 ready", () => {
    const s = makeBattleState({ dp: 20, squadOperatorIds: ["op_guard_01"] });
    deployOperator(s, "op_guard_01", { row: 2, col: 1 });
    retreatOperator(s, "op_guard_01");
    for (let i = 0; i < 69; i++) deploymentSystem(s, 1);
    expect(s.squad[0].state).toBe("cooldown");
    deploymentSystem(s, 1); // 共 70 秒
    expect(s.squad[0].state).toBe("ready");
    expect(s.squad[0].cooldownRemaining).toBe(0);
  });
});
