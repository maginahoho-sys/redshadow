/**
 * 干员阵亡再部署冷却验收测试（bug 修复回归）
 *
 * 背景：修复前 cleanupDeaths 只销毁干员实体，SquadMember 卡在 "deployed"，
 * 冷却永远不会启动，导致阵亡干员永远无法重新部署（提示"干员已在场上"）。
 *
 * 覆盖点（走真实部署链路 deployOperator，不绕过部署系统）：
 * 1. 干员被击败后成员进入 cooldown，冷却时长 = redeployCooldown，且不退费；
 * 2. 冷却期间 canDeploy 失败，原因"再部署冷却中"；
 * 3. 冷却走完恢复 ready，可成功重新部署；
 * 4. 重新部署后的干员可再次正常作战（攻击结算生效）。
 */
import { describe, it, expect } from "vitest";
import { makeBattleState, health, tick, spawnEnemy } from "./helpers";
import { combatSystem } from "../src/systems/combat";
import { deploymentSystem, deployOperator, canDeploy } from "../src/systems/deployment";

const SYS = [deploymentSystem, combatSystem] as const;

/** 部署一名干员并返回 { 实体 id, 成员记录 } */
function deploy(state: ReturnType<typeof makeBattleState>, opId: string, row = 2, col = 1) {
  const id = deployOperator(state, opId, { row, col });
  expect(id).toBeGreaterThan(0); // 部署必须成功（格子合法、费用足够）
  const member = state.squad.find(m => m.operatorId === opId)!;
  return { id, member };
}

describe("干员阵亡后再部署冷却", () => {
  it("阵亡后进入冷却：状态 cooldown、时长正确、不退费", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_guard_01"], dp: 100 });
    const { id, member } = deploy(state, "op_guard_01");
    expect(member.state).toBe("deployed");
    const dpAfterDeploy = state.dp;

    // 击杀：血量归零后跑战斗结算（含死亡清理）
    health(state, id).hp = 0;
    tick(state, 0.1, [combatSystem]);

    expect(state.world.alive(id)).toBe(false);          // 实体已销毁
    expect(member.state).toBe("cooldown");              // 成员进入冷却
    expect(member.cooldownRemaining).toBe(state.effective["op_guard_01"].redeployCooldown);
    expect(state.dp).toBe(dpAfterDeploy);               // 阵亡不退费（与撤退不同）
    expect(member.entityId).toBeUndefined();            // 实体引用已清空
  });

  it("冷却期间无法部署，提示'再部署冷却中'", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_guard_01"], dp: 100 });
    const { id, member } = deploy(state, "op_guard_01");
    health(state, id).hp = 0;
    tick(state, 0.1, [combatSystem]);

    const check = canDeploy(state, "op_guard_01", { row: 2, col: 1 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("再部署冷却中");
    expect(member.state).toBe("cooldown");
  });

  it("冷却走完恢复 ready，可成功重新部署", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_guard_01"], dp: 100 });
    const { id, member } = deploy(state, "op_guard_01");
    const cooldown = state.effective["op_guard_01"].redeployCooldown;
    health(state, id).hp = 0;
    tick(state, 0.1, [combatSystem]);

    // 冷却倒计时走满（deploymentSystem 每 tick 递减）
    tick(state, cooldown, [deploymentSystem]);
    expect(member.state).toBe("ready");
    expect(member.cooldownRemaining).toBe(0);

    // 重新部署成功，状态回到 deployed
    const id2 = deployOperator(state, "op_guard_01", { row: 2, col: 1 });
    expect(id2).toBeGreaterThan(0);
    expect(member.state).toBe("deployed");
    expect(member.entityId).toBe(id2);
  });

  it("重新部署后的干员可再次正常作战", () => {
    const state = makeBattleState({ squadOperatorIds: ["op_guard_01"], dp: 100 });
    const { id, member } = deploy(state, "op_guard_01");
    health(state, id).hp = 0;
    tick(state, 0.1, [combatSystem]);
    tick(state, state.effective["op_guard_01"].redeployCooldown, [deploymentSystem]);

    // 在同一格重新部署，路上放一名敌人走入该格建立阻挡后被打
    const id2 = deployOperator(state, "op_guard_01", { row: 2, col: 1 });
    expect(id2).toBeGreaterThan(0);
    expect(member.state).toBe("deployed");

    // 敌人出生在与干员同格的路上 → assignBlocking 建立阻挡 → 干员攻击（间隔 1.4s）
    const enemy = spawnEnemy(state, { row: 2, col: 1, waypoints: [{ row: 2, col: 1 }, { row: 2, col: 2 }] });
    tick(state, state.effective["op_guard_01"].attackInterval + 0.1, [deploymentSystem, combatSystem]);
    const hp = state.world.get(enemy, "health");
    expect(hp && hp.hp).toBeLessThan(hp ? hp.maxHp : Infinity);
  });
});
