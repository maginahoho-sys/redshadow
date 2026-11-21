/**
 * combat.ts —— M1 战斗结算系统
 *
 * 职责：伤害公式、阻挡判定、攻击计时与目标选择、死亡清理。
 * 纯逻辑层：不 import Phaser，不持有全局状态，所有读写都发生在传入的 BattleState 内。
 *
 * 行为规则速记（详见 specs/m1-战斗结算.md）：
 *   - 物理：max(atk - def, atk*5%)；法术：max(atk*(1-res/100), atk*5%)，res 夹紧 [0,100]
 *   - 阻挡：敌人所在格 = (round(row), round(col))，与干员格重合且剩余阻挡位足够则建立阻挡
 *   - 干员攻击：优先打被自己阻挡的存活敌人（不受射程限制），再打射程内其他敌人
 *     （按路点 index 降序、到下一路点距离升序）；timer 累积到 interval 攻击一次，
 *     攻击后 timer -= interval（大步长允许补一次攻击，不叠加多次）
 *   - 敌人攻击：仅被阻挡时攻击其阻挡者，无视射程
 *   - 死亡清理：所有攻击结算完后统一处理 hp <= 0 的实体；
 *     干员死亡额外把 SquadMember 置入再部署冷却（不退费），避免状态卡在 deployed
 * */

import type {
  BattleState,
  DamageType,
  CAttack,
  CEnemyPath,
  EntityId
} from "../contracts";

/** 单次攻击结算信息（内部使用） */
interface PendingHit {
  attacker: number;
  target: number;
}

/**
 * 伤害公式。
 * 物理：max(atk - def, atk*0.05)
 * 法术：max(atk*(1-res/100), atk*0.05)，res 先夹紧到 [0,100]
 * 5% 下限保证任何攻击都至少有一点点作用（atk=0 时下限为 0）。
 */
export function calcDamage(atk: number, def: number, res: number, type: DamageType): number {
  const floor = atk * 0.05;
  if (type === "physical") {
    return Math.max(atk - def, floor);
  }
  // 法术：法抗夹紧 [0,100]
  const clamped = Math.min(100, Math.max(0, res));
  return Math.max(atk * (1 - clamped / 100), floor);
}

/** 计算敌人到其当前目标路点的距离（已越过全部路点则返回 0） */
function distToNextWaypoint(path: CEnemyPath, posRow: number, posCol: number): number {
  const wp = path.waypoints[path.index];
  if (!wp) return 0;
  const dr = wp.row - posRow;
  const dc = wp.col - posCol;
  return Math.sqrt(dr * dr + dc * dc);
}

/** 干员剩余阻挡位 = capacity - Σ(已阻挡敌人的 blockWeight) */
function remainingBlockCapacity(state: BattleState, operatorId: number): number {
  const block = state.world.get(operatorId, "block");
  if (!block) return 0;
  let used = 0;
  for (const enemyId of block.blocked) {
    const path = state.world.get(enemyId, "enemyPath");
    if (path) used += path.blockWeight;
  }
  return block.capacity - used;
}

/**
 * 阻挡判定：为尚未被阻挡且已进入干员格子的敌人分配阻挡。
 * 敌人按实体 id 升序遍历（query 保证升序）；每名敌人每帧最多被一名干员阻挡；
 * 剩余阻挡位不足则保持未阻挡，下一帧再试。
 */
export function assignBlocking(state: BattleState): void {
  const operators = state.world.query("block", "position");
  for (const enemyId of state.world.query("enemyPath")) {
    const path = state.world.get(enemyId, "enemyPath");
    if (!path || path.blockedBy !== -1) continue;

    const pos = state.world.get(enemyId, "position");
    if (!pos) continue;
    // 敌人所在格 = 四舍五入取整
    const enemyRow = Math.round(pos.row);
    const enemyCol = Math.round(pos.col);

    for (const operatorId of operators) {
      const opos = state.world.get(operatorId, "position");
      if (!opos) continue;
      // 格子不重合直接跳过
      if (opos.row !== enemyRow || opos.col !== enemyCol) continue;
      // 剩余阻挡位不足则跳过（blockWeight ≤ 剩余位才可阻挡）
      if (path.blockWeight > remainingBlockCapacity(state, operatorId)) continue;

      // 建立阻挡：双向写入 + 发事件，然后该敌人本帧结束匹配
      const block = state.world.get(operatorId, "block")!;
      block.blocked.push(enemyId);
      path.blockedBy = operatorId;
      state.bus.emit({ type: "enemyBlocked", enemyId, blockerId: operatorId });
      break;
    }
  }
}

/**
 * 干员目标选择。
 * 第一优先：被自己阻挡的存活敌人（阻挡目标不受射程限制——近战贴身必打）；
 * 第二优先：射程内的其他敌人，按「路点 index 降序、到下一路点距离升序」排序
 * （走得越远、越接近下一路点的敌人威胁越大，优先击杀）。
 * 返回按优先级排好序的目标列表，调用方按 targetLimit 截取。
 */
function pickOperatorTargets(state: BattleState, operatorId: number): number[] {
  const block = state.world.get(operatorId, "block");
  const identity = state.world.get(operatorId, "identity");
  const myPos = state.world.get(operatorId, "position");
  if (!identity || !myPos) return [];

  // 第一优先：被自己阻挡的存活敌人
  const blockedFirst: number[] = [];
  if (block) {
    for (const enemyId of block.blocked) {
      if (!state.world.alive(enemyId)) continue;
      if (!state.world.has(enemyId, "enemyPath")) continue;
      blockedFirst.push(enemyId);
    }
  }

  // 攻击范围：相对自身格的偏移集合（M4 词条结算产物 effective.range）
  const eff = state.effective[identity.defId];
  const rangeSet = new Set<string>(
    eff ? eff.range.map(([dr, dc]) => `${dr},${dc}`) : []
  );

  // 第二优先：射程内的其他敌人
  const others: number[] = [];
  for (const enemyId of state.world.query("enemyPath")) {
    if (blockedFirst.includes(enemyId)) continue;
    const pos = state.world.get(enemyId, "position");
    if (!pos) continue;
    // 敌人格取整后换算成相对偏移，落在范围集合内即在射程中
    const key = `${Math.round(pos.row) - myPos.row},${Math.round(pos.col) - myPos.col}`;
    if (!rangeSet.has(key)) continue;
    others.push(enemyId);
  }

  // 排序：路点 index 降序（走得远优先）→ 到下一路点距离升序（更接近者优先）
  others.sort((a, b) => {
    const pa = state.world.get(a, "enemyPath")!;
    const pb = state.world.get(b, "enemyPath")!;
    if (pb.index !== pa.index) return pb.index - pa.index;
    const posA = state.world.get(a, "position")!;
    const posB = state.world.get(b, "position")!;
    const da = distToNextWaypoint(pa, posA.row, posA.col);
    const db = distToNextWaypoint(pb, posB.row, posB.col);
    return da - db;
  });

  return [...blockedFirst, ...others];
}

/** 敌人目标：其阻挡者（无视射程）；未被阻挡或阻挡者已死亡则无目标 */
function pickEnemyTarget(state: BattleState, enemyId: number): number[] {
  const path = state.world.get(enemyId, "enemyPath");
  if (!path || path.blockedBy === -1) return [];
  const blockerId = path.blockedBy;
  // 阻挡者已死亡则不攻击（死亡清理稍后会解除引用）
  if (!state.world.alive(blockerId)) return [];
  return [blockerId];
}

/**
 * 医疗目标选择（M16 扩展）：射程内受伤的干员，按 hp/maxHp 比例升序（最重者优先）。
 * 满血干员不选中；治疗量 = atk（不套伤害公式、不吃 def/res）。
 */
function pickMedicTargets(state: BattleState, medicId: number): number[] {
  const identity = state.world.get(medicId, "identity");
  const myPos = state.world.get(medicId, "position");
  if (!identity || !myPos) return [];

  const eff = state.effective[identity.defId];
  const rangeSet = new Set<string>(
    eff ? eff.range.map(([dr, dc]) => `${dr},${dc}`) : []
  );

  const wounded: { id: number; ratio: number }[] = [];
  for (const opId of state.world.query("block", "position")) {
    if (opId === medicId) continue; // 不奶自己（满血也不需要）
    const pos = state.world.get(opId, "position")!;
    const key = `${pos.row - myPos.row},${pos.col - myPos.col}`;
    if (!rangeSet.has(key)) continue;
    const health = state.world.get(opId, "health");
    if (!health || health.hp <= 0 || health.hp >= health.maxHp) continue;
    wounded.push({ id: opId, ratio: health.hp / health.maxHp });
  }
  wounded.sort((a, b) => a.ratio - b.ratio);
  return wounded.map(w => w.id);
}

/** 该干员是否医疗（按职业判定；数据驱动，无需新字段） */
function isMedic(state: BattleState, operatorId: number): boolean {
  const identity = state.world.get(operatorId, "identity");
  if (!identity) return false;
  const def = state.operatorDefs[identity.defId];
  return def?.profession === "medic";
}

/** 执行一次攻击：按伤害公式扣血并发 attackLanded 事件 */
function resolveHits(state: BattleState, hits: PendingHit[], atk: CAttack): void {
  for (const hit of hits) {
    const targetAtk = state.world.get(hit.target, "attack");
    const targetHealth = state.world.get(hit.target, "health");
    if (!targetAtk || !targetHealth) continue; // 目标组件缺失，防御性跳过
    const damage = calcDamage(atk.atk, targetAtk.def, targetAtk.res, atk.damageType);
    targetHealth.hp -= damage;
    state.bus.emit({
      type: "attackLanded",
      attacker: hit.attacker,
      target: hit.target,
      damage,
      damageType: atk.damageType
    });
  }
}

/**
 * 死亡清理：结算完所有攻击后统一处理。
 * - hp <= 0 的实体销毁并发 entityDied；
 * - 敌人死亡：从其阻挡者的 blocked 列表移除自己；
 * - 干员死亡：所有 blockedBy 指向它的敌人重置为未阻挡。
 */
function cleanupDeaths(state: BattleState): void {
  // 先收集本帧死亡名单（组件读取必须在 destroyEntity 之前，销毁后组件即被清除）
  interface DeadRecord {
    id: number;
    faction: "operator" | "enemy";
    blockerId: number; // 敌人死亡时的阻挡者；干员为 -1
  }
  const dead: DeadRecord[] = [];
  for (const id of state.world.query("health")) {
    const health = state.world.get(id, "health");
    if (!health || health.hp > 0) continue;
    const identity = state.world.get(id, "identity");
    if (!identity) continue;
    let blockerId = -1;
    if (identity.faction === "enemy") {
      const path = state.world.get(id, "enemyPath");
      blockerId = path ? path.blockedBy : -1;
    }
    dead.push({ id, faction: identity.faction, blockerId });
  }

  // 统一销毁并发事件
  for (const d of dead) {
    state.world.destroyEntity(d.id);
    state.bus.emit({ type: "entityDied", entityId: d.id, faction: d.faction });
    // 敌人死亡：从阻挡者的 blocked 列表中移除自己
    if (d.faction === "enemy" && d.blockerId !== -1) {
      const block = state.world.get(d.blockerId, "block");
      if (block) {
        block.blocked = block.blocked.filter(enemyId => enemyId !== d.id);
      }
    }
  }

  // 干员死亡：解除其阻挡的所有敌人（下一帧可被其他干员重新阻挡），
  // 并把成员状态置入再部署冷却（等价撤退的冷却处理，但不退费）。
  // 缺此步会让 SquadMember 卡在 "deployed"，冷却结束后仍提示"干员已在场上"。
  const deadOperators = dead.filter(d => d.faction === "operator").map(d => d.id);
  if (deadOperators.length === 0) return;
  for (const enemyId of state.world.query("enemyPath")) {
    const path = state.world.get(enemyId, "enemyPath");
    if (path && deadOperators.includes(path.blockedBy)) {
      path.blockedBy = -1;
    }
  }
  for (const opId of deadOperators) {
    const member = state.squad.find(m => m.entityId === opId);
    if (!member || member.state !== "deployed") continue;
    // 冷却时长取词条结算后的有效属性，缺失时回退干员定义
    const eff = state.effective[member.operatorId];
    const def = state.operatorDefs[member.operatorId];
    member.cooldownRemaining = (eff ?? def).redeployCooldown;
    member.state = "cooldown";
    member.entityId = undefined;
  }
}

/**
 * 攻击结算主入口：每帧调用。
 * 处理所有拥有 attack 组件的存活实体的攻击计时、目标选择、伤害结算，
 * 最后统一做死亡清理。
 */
export function combatSystem(state: BattleState, dt: number): void {
  for (const id of state.world.query("attack")) {
    if (!state.world.alive(id)) continue;
    const atk = state.world.get(id, "attack");
    const identity = state.world.get(id, "identity");
    if (!atk || !identity) continue;

    // 1) 计时：累积到间隔才攻击
    atk.timer += dt;
    if (atk.timer < atk.interval) continue;

    // 2) 目标选择：医疗干员治疗友军，其余照常打敌人
    let targets: number[];
    let healing = false;
    if (identity.faction === "operator" && isMedic(state, id)) {
      targets = pickMedicTargets(state, id);
      healing = true;
    } else if (identity.faction === "operator") {
      targets = pickOperatorTargets(state, id);
    } else {
      targets = pickEnemyTarget(state, id);
    }
    const hitList: PendingHit[] = targets
      .slice(0, Math.max(0, atk.targetLimit))
      .map(target => ({ attacker: id, target }));
    if (hitList.length === 0) continue; // 无目标：计时保留，出现目标后立即补攻击

    // 3) 结算：治疗 = 回血（夹紧 maxHp，不吃 def/res）；攻击 = 伤害公式
    if (healing) {
      for (const hit of hitList) {
        const health = state.world.get(hit.target, "health");
        if (!health || health.hp <= 0) continue;
        health.hp = Math.min(health.maxHp, health.hp + atk.atk);
      }
    } else {
      resolveHits(state, hitList, atk);
    }
    atk.timer -= atk.interval;
  }

  // 4) 统一死亡清理
  cleanupDeaths(state);
}
