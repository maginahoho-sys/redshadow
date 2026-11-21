/**
 * movement.ts —— M2 敌人寻路移动系统
 *
 * 职责：让敌人沿路点序列移动；被阻挡时停住；到达终点（防御点）时漏怪扣目标生命。
 * 纯逻辑层：不 import Phaser，不持有全局状态，所有读写都发生在传入的 BattleState 内。
 *
 * 行为规则速记（详见 specs/m2-敌人寻路.md）：
 *   - blockedBy !== -1 的敌人本帧不动
 *   - 本帧预算 = speed * dt，逐路点消耗（大步长不跳过路点）；
 *     对每个目标路点先对齐 row 再对齐 col（先纵向后横向）
 *   - 抵达路点（row/col 对齐）则 index += 1，用剩余预算继续
 *   - index 走完整个路点序列 → 漏怪：扣 objectiveHp、发 enemyLeaked、销毁实体
 *   - 浮点容差 1e-6；预算恰好用尽停在终点格不算漏怪（须在仍有预算时越过/抵达才漏）
 *   - 敌人出生位置可能已越过 index 指向的路点（测试/运行时均可能发生）：
 *     先沿段方向把 index 快进到实际位置对应的路点，避免往回走
 */

import type { BattleState, CEnemyPath, CPosition } from "../contracts";

/** 浮点判定容差 */
const EPS = 1e-6;

/**
 * 快进：若敌人实际位置已沿段方向越过当前目标路点，则推进 index。
 * 越过判定：向量 (pos - target) 在段方向 (target - prev) 上的投影 > EPS。
 * index 从 1 开始（waypoints[0] 是出生点），因此 prev 总是存在的；
 * 防御性处理 index === 0 的情况（dir 为零向量，投影为 0，不会误跳）。
 */
function skipPassedWaypoints(path: CEnemyPath, pos: CPosition): void {
  while (path.index < path.waypoints.length) {
    const target = path.waypoints[path.index];
    const prev = path.waypoints[path.index - 1] ?? target;
    const dirR = target.row - prev.row;
    const dirC = target.col - prev.col;
    const over = (pos.row - target.row) * dirR + (pos.col - target.col) * dirC;
    if (over > EPS) {
      path.index += 1;
      continue;
    }
    break;
  }
}

/**
 * 用剩余预算向当前目标路点移动（先纵向后横向），抵达则 index += 1。
 * 每次迭代要么消耗预算、要么推进 index，必然终止。
 */
function advanceAlongPath(path: CEnemyPath, pos: CPosition, budget: number): void {
  while (budget > EPS && path.index < path.waypoints.length) {
    const target = path.waypoints[path.index];

    // 1) 先纵向对齐 row
    const dr = target.row - pos.row;
    if (Math.abs(dr) > EPS) {
      const step = Math.min(Math.abs(dr), budget);
      pos.row += Math.sign(dr) * step;
      budget -= step;
      if (Math.abs(target.row - pos.row) <= EPS) pos.row = target.row;
      continue;
    }

    // 2) 再横向对齐 col
    const dc = target.col - pos.col;
    if (Math.abs(dc) > EPS) {
      const step = Math.min(Math.abs(dc), budget);
      pos.col += Math.sign(dc) * step;
      budget -= step;
      if (Math.abs(target.col - pos.col) <= EPS) pos.col = target.col;
      continue;
    }

    // 3) row/col 均已对齐 → 抵达该路点，进入下一个
    path.index += 1;
  }
}

/**
 * 每帧推进所有敌人的移动；处理终点漏怪。
 * 遍历顺序按实体 id 升序（world.query 保证）；漏怪立即销毁实体。
 */
export function movementSystem(state: BattleState, dt: number): void {
  for (const id of state.world.query("enemyPath")) {
    if (!state.world.alive(id)) continue;
    const path = state.world.get(id, "enemyPath");
    const pos = state.world.get(id, "position");
    if (!path || !pos) continue;

    // 被阻挡的敌人本帧不动
    if (path.blockedBy !== -1) continue;

    // 先快进越过已通过的路点，再消耗本帧预算移动
    skipPassedWaypoints(path, pos);
    advanceAlongPath(path, pos, path.speed * dt);

    // 走完整个路点序列 → 漏怪：扣目标生命（夹紧不低于 0）、发事件、销毁实体
    if (path.index >= path.waypoints.length) {
      state.objectiveHp = Math.max(0, state.objectiveHp - path.leakDamage);
      state.bus.emit({ type: "enemyLeaked", entityId: id, leakDamage: path.leakDamage });
      state.world.destroyEntity(id);
    }
  }
}
