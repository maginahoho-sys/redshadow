/**
 * deployment.ts —— M3 部署与费用系统
 *
 * 职责：部署/撤退的合法性判定与执行、费用自然回复（含先锋加成）、再部署冷却倒计时。
 * 纯逻辑层：不 import Phaser，不持有全局状态，所有读写都发生在传入的 BattleState 内。
 *
 * 行为规则速记（详见 specs/m3-部署费用.md）：
 *   - canDeploy 按序判定：队伍成员且 ready → 格子在界内 → 地形合法
 *     （melee 只能 'r'，ranged 只能 'h'，S/G/#/. 一律不行）→ 格子无其他干员 → 费用足够
 *   - deployOperator：canDeploy 不通过返回 -1 且零变化；通过则扣费、建实体、
 *     成员置 deployed、发 operatorDeployed
 *   - retreatOperator：仅 deployed 可退；销毁实体、解除其阻挡的敌人、全额退费、
 *     进入冷却、发 operatorRetreated
 *   - deploymentSystem：dp += (globals.dpRate + Σ已部署干员的 dpBonusRate) * dt；
 *     cooldown 成员倒计时，归零置 ready
 */

import type { BattleState, Vec2, SquadMember } from "../contracts";

/** 部署判定结果 */
export interface DeployCheck {
  ok: boolean;
  /** 失败原因（中文，供 UI 提示；成功时缺省） */
  reason?: string;
}

/** 失败结果快捷构造 */
function fail(reason: string): DeployCheck {
  return { ok: false, reason };
}

/** 在队伍里找到指定干员的成员记录 */
function findMember(state: BattleState, operatorId: string): SquadMember | undefined {
  return state.squad.find(m => m.operatorId === operatorId);
}

/** 地形合法性：melee 只能 'r'，ranged 只能 'h' */
function terrainOk(terrainChar: string, placement: "melee" | "ranged"): boolean {
  if (placement === "melee") return terrainChar === "r";
  return terrainChar === "h";
}

/**
 * 判定某干员能否部署到某格（不产生任何变化）。
 * 按序判定，任一失败立即返回失败原因。
 */
export function canDeploy(state: BattleState, operatorId: string, cell: Vec2): DeployCheck {
  // 1) 必须在队伍中且状态为 ready
  const member = findMember(state, operatorId);
  if (!member) return fail("干员不在编队中");
  if (member.state !== "ready") {
    return fail(member.state === "cooldown" ? "再部署冷却中" : "干员已在场上");
  }

  // 2) 格子在地图范围内
  const stage = state.stage;
  if (cell.row < 0 || cell.row >= stage.rows || cell.col < 0 || cell.col >= stage.cols) {
    return fail("超出地图范围");
  }

  // 3) 地形合法：近战只能 'r'，远程只能 'h'
  const eff = state.effective[operatorId];
  if (!eff) return fail("缺少有效属性数据");
  const terrainChar = stage.terrain[cell.row]?.[cell.col];
  if (terrainChar === undefined) return fail("超出地图范围");
  const placement = placementOf(state, operatorId);
  if (!terrainOk(terrainChar, placement)) {
    return fail(placement === "melee" ? "近战干员只能部署在地面道路" : "远程干员只能部署在高台");
  }

  // 4) 格子上没有其他干员（干员实体都持有 block 组件）
  for (const id of state.world.query("block")) {
    const pos = state.world.get(id, "position");
    if (pos && pos.row === cell.row && pos.col === cell.col) {
      return fail("目标格子已被占据");
    }
  }

  // 5) 费用足够
  if (state.dp < eff.cost) return fail("费用不足");

  return { ok: true };
}

/** 取干员的放置类型（近战/远程），来自有效属性缺失时回退干员定义 */
function placementOf(state: BattleState, operatorId: string): "melee" | "ranged" {
  const def = state.operatorDefs[operatorId];
  return def ? def.placement : "melee";
}

/**
 * 部署干员。成功返回实体 id；失败返回 -1 且状态零变化。
 * 组件数值全部取自 state.effective[operatorId]（词条结算后的有效属性）。
 */
export function deployOperator(state: BattleState, operatorId: string, cell: Vec2): number {
  const check = canDeploy(state, operatorId, cell);
  if (!check.ok) return -1;

  const eff = state.effective[operatorId];
  const def = state.operatorDefs[operatorId];

  // 扣费
  state.dp -= eff.cost;

  // 创建实体并挂组件
  const id = state.world.createEntity();
  state.world.add(id, "identity", { defId: operatorId, faction: "operator", name: def.name });
  state.world.add(id, "position", { row: cell.row, col: cell.col });
  state.world.add(id, "health", { hp: eff.hp, maxHp: eff.hp });
  state.world.add(id, "attack", {
    atk: eff.atk,
    def: eff.def,
    res: eff.res,
    damageType: eff.damageType,
    interval: eff.attackInterval,
    timer: 0,
    targetLimit: 1
  });
  state.world.add(id, "block", { capacity: eff.blockCount, blocked: [] });
  state.world.add(id, "tags", { tags: [...eff.tags] });

  // 更新队伍成员状态
  const member = findMember(state, operatorId)!;
  member.state = "deployed";
  member.entityId = id;

  state.bus.emit({ type: "operatorDeployed", entityId: id, operatorId, at: cell });
  return id;
}

/**
 * 撤退干员：全额退费、进入再部署冷却、移除实体、解除其阻挡的敌人。
 * 仅 deployed 状态可撤退；成功返回 true。
 */
export function retreatOperator(state: BattleState, operatorId: string): boolean {
  const member = findMember(state, operatorId);
  if (!member || member.state !== "deployed" || member.entityId === undefined) return false;

  const entityId = member.entityId;

  // 解除该干员阻挡的所有敌人（下一帧可被其他干员重新阻挡）
  for (const enemyId of state.world.query("enemyPath")) {
    const path = state.world.get(enemyId, "enemyPath");
    if (path && path.blockedBy === entityId) path.blockedBy = -1;
  }

  // 销毁实体
  state.world.destroyEntity(entityId);

  // 全额退费（cost 取当前有效属性值）
  const eff = state.effective[operatorId];
  state.dp += eff.cost;

  // 进入冷却
  member.state = "cooldown";
  member.cooldownRemaining = eff.redeployCooldown;
  member.entityId = undefined;

  state.bus.emit({ type: "operatorRetreated", operatorId });
  return true;
}

/**
 * 帧更新：费用自然回复（含已部署先锋的 dpBonusRate 加成）、冷却倒计时。
 * 先锋加成取各 deployed 成员对应干员的 effective.dpBonusRate（缺省 0）。
 */
export function deploymentSystem(state: BattleState, dt: number): void {
  // 1) 统计已部署干员的费用回复加成
  let bonus = 0;
  for (const member of state.squad) {
    if (member.state !== "deployed") continue;
    const eff = state.effective[member.operatorId];
    if (eff) bonus += eff.dpBonusRate;
  }
  state.dp += (state.globals.dpRate + bonus) * dt;

  // 2) 冷却倒计时：归零后回到 ready
  for (const member of state.squad) {
    if (member.state !== "cooldown") continue;
    member.cooldownRemaining -= dt;
    if (member.cooldownRemaining <= 0) {
      member.cooldownRemaining = 0;
      member.state = "ready";
    }
  }
}
