/**
 * battle-glue.ts —— 战斗装配器（M8 交付物之一）
 *
 * 职责：
 *  1. createBattle：按 BattleSetupOptions 组装一场战斗的完整 BattleState
 *     （不运行任何系统，实体也一个不建——干员由部署系统创建，敌人由波次系统创建）。
 *  2. stepBattle：每帧按固定顺序推进各逻辑系统。
 *
 * 【系统调用顺序（冻结，不可调整）】
 *     waveSystem → movementSystem → assignBlocking → combatSystem
 *     → deploymentSystem → checkBattleEnd
 *   其中 state.time 的累加由本函数负责（各系统只读不写 time）。
 *
 * 本文件禁止 import Phaser；战斗规则数值全部由各系统函数承担。
 */

import {
  createWorld, createBus, createRng,
  type BattleState, type StageDef, type OperatorDef, type EnemyDef,
  type EffectiveStats, type EffectiveGlobals, type GameEvent
} from "../contracts";
import { combatSystem, assignBlocking } from "../systems/combat";
import { movementSystem } from "../systems/movement";
import { deploymentSystem } from "../systems/deployment";
import { waveSystem, checkBattleEnd } from "../systems/waves";

/** 战斗装配参数（effective/globals 为 M4 词条结算产物） */
export interface BattleSetupOptions {
  stage: StageDef;
  squadOperatorIds: string[];
  operatorDefs: Record<string, OperatorDef>;   // 原始定义
  enemyDefs: Record<string, EnemyDef>;         // 词条结算后的最终定义（M4 产物）
  effective: Record<string, EffectiveStats>;   // 词条结算后的干员有效属性（M4 产物）
  globals: EffectiveGlobals;                   // 词条结算后的全局参数（M4 产物）
  seed: number;
}

/** 组装 BattleState（不运行任何系统） */
export function createBattle(opts: BattleSetupOptions): BattleState {
  const g = opts.globals;
  return {
    stage: opts.stage,
    world: createWorld(),
    bus: createBus<GameEvent>(),
    rng: createRng(opts.seed),
    operatorDefs: opts.operatorDefs,
    enemyDefs: opts.enemyDefs,
    time: 0,
    dp: g.initialDp,
    objectiveHp: g.objectiveHp,
    tempObjectiveHp: g.tempObjectiveHp,
    squad: opts.squadOperatorIds.map(id => ({
      operatorId: id,
      state: "ready" as const,
      cooldownRemaining: 0
    })),
    effective: opts.effective,
    globals: g,
    status: "running",
    waveIndex: 0,
    waveTimer: 0,
    pendingSpawns: [],
    currentWaveAllSpawned: false
  };
}

/** 每帧按固定顺序推进：出怪 → 移动 → 阻挡 → 攻击 → 费用/冷却 → 胜负 */
export function stepBattle(state: BattleState, dt: number): void {
  state.time += dt;
  waveSystem(state, dt);
  movementSystem(state, dt);
  assignBlocking(state);
  combatSystem(state, dt);
  deploymentSystem(state, dt);
  checkBattleEnd(state);
}
