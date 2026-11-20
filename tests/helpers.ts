/**
 * tests/helpers.ts —— 逻辑模块（M1–M7）验收测试共用的战斗夹具。
 *
 * 说明：这里直接按合同手工构造实体/状态，不经过任何待测系统代码，
 * 因此每个模块的测试都可以独立编译运行。
 * tests/pending/ 里的测试移入 tests/ 后，把 `from "../helpers"` 改为 `from "./helpers"`。
 */

import {
  createWorld, createBus, createRng,
  type World, type EventBus, type Rng,
  type BattleState, type OperatorDef, type EnemyDef, type StageDef,
  type EffectiveStats, type EffectiveGlobals, type GameEvent,
  type CIdentity, type CPosition, type CHealth, type CAttack,
  type CBlock, type CEnemyPath, type CTags,
  type RunState, type NodeMap
} from "../src/contracts";

import operatorsJson from "../src/data/operators.json";
import enemiesJson from "../src/data/enemies.json";
import stagesJson from "../src/data/stages.json";
import runConfigJson from "../src/data/run-config.json";

export const RUN_CONFIG = runConfigJson as unknown as {
  runStart: { hope: number; hopeCap: number; ingots: number; objectiveHp: number; objectiveHpCap: number; squadSizeBase: number };
  recruitCostByRarity: Record<string, number>;
  promoteCostByRarity: Record<string, number>;
  floors: { floorName: string; nodeCountRange: number[]; weights: Record<string, number> }[];
  teams: { id: string; name: string; description: string; mods: unknown[] }[];
};

/** 最小可用节点图（RunState 夹具用） */
export function trivialNodeMap(): NodeMap {
  return {
    floor: 1,
    floorName: "测试层",
    nodes: { n1: { id: "n1", type: "battle", row: 0, col: 0, next: [] } },
    start: "n1",
    boss: "n1"
  };
}

export interface TestRunOptions {
  hope?: number;
  ingots?: number;
  objectiveHp?: number;
  squad?: string[];
  reserve?: string[];
  relics?: string[];
}

/** 构造一个测试用 RunState（不依赖 M6/M7 的任何实现） */
export function makeRunState(opts: TestRunOptions = {}): RunState {
  const base = RUN_CONFIG.runStart;
  return {
    seed: 1,
    teamId: "team_command",
    floor: 1,
    nodeMap: trivialNodeMap(),
    currentNodeId: null,
    visitedNodeIds: [],
    hope: opts.hope ?? base.hope,
    hopeCap: base.hopeCap,
    ingots: opts.ingots ?? base.ingots,
    objectiveHp: opts.objectiveHp ?? base.objectiveHp,
    objectiveHpCap: base.objectiveHpCap,
    squad: opts.squad ? [...opts.squad] : [],
    reserve: opts.reserve ? [...opts.reserve] : [],
    promoted: {},
    relics: opts.relics ? [...opts.relics] : [],
    recruitTickets: [],
    recruitPools: {},
    eventLog: []
  };
}

export const OPERATOR_DEFS: Record<string, OperatorDef> = Object.fromEntries(
  (operatorsJson as unknown as OperatorDef[]).map(o => [o.id, o])
);
export const ENEMY_DEFS: Record<string, EnemyDef> = Object.fromEntries(
  (enemiesJson as EnemyDef[]).map(e => [e.id, e])
);
export const STAGE: StageDef = (stagesJson as StageDef[])[0];

/** 由 OperatorDef 构造未受词条影响的基准有效属性 */
export function baseEffective(op: OperatorDef): EffectiveStats {
  return {
    cost: op.cost,
    hp: op.hp,
    atk: op.atk,
    def: op.def,
    res: op.res,
    attackInterval: op.attackInterval,
    blockCount: op.blockCount,
    damageType: op.damageType,
    range: op.range,
    redeployCooldown: op.redeployCooldown,
    dpBonusRate: op.dpBonusRate ?? 0,
    tags: [...(op.tags ?? [])]
  };
}

export function baseGlobals(stage: StageDef): EffectiveGlobals {
  return {
    dpRate: stage.dpRate,
    initialDp: stage.initialDp,
    objectiveHp: stage.objectiveHp,
    tempObjectiveHp: 0,
    squadSize: 4
  };
}

export interface TestBattleOptions {
  seed?: number;
  dp?: number;
  objectiveHp?: number;
  squadOperatorIds?: string[];
  stage?: StageDef;
}

/** 构造一个测试用 BattleState（不运行任何系统） */
export function makeBattleState(opts: TestBattleOptions = {}): BattleState {
  const stage = opts.stage ?? STAGE;
  const rng: Rng = createRng(opts.seed ?? 1);
  const bus: EventBus<GameEvent> = createBus<GameEvent>();
  const world: World = createWorld();
  const squad = (opts.squadOperatorIds ?? []).map(id => ({
    operatorId: id,
    state: "ready" as const,
    cooldownRemaining: 0
  }));
  const effective: Record<string, EffectiveStats> = {};
  for (const id of Object.keys(OPERATOR_DEFS)) effective[id] = baseEffective(OPERATOR_DEFS[id]);
  return {
    stage,
    world,
    bus,
    rng,
    operatorDefs: OPERATOR_DEFS,
    enemyDefs: ENEMY_DEFS,
    time: 0,
    dp: opts.dp ?? 999,
    objectiveHp: opts.objectiveHp ?? stage.objectiveHp,
    tempObjectiveHp: 0,
    squad,
    effective,
    globals: baseGlobals(stage),
    status: "running",
    waveIndex: 0,
    waveTimer: 0,
    pendingSpawns: [],
    currentWaveAllSpawned: false
  };
}

/** 在指定格放置一名干员（绕过部署系统，直接构造实体），返回实体 id */
export function placeOperator(state: BattleState, operatorId: string, row: number, col: number): number {
  const op = state.operatorDefs[operatorId];
  const eff = state.effective[operatorId];
  const id = state.world.createEntity();
  state.world.add(id, "identity", { defId: operatorId, faction: "operator", name: op.name });
  state.world.add(id, "position", { row, col });
  state.world.add(id, "health", { hp: eff.hp, maxHp: eff.hp });
  state.world.add(id, "attack", {
    atk: eff.atk, def: eff.def, res: eff.res,
    damageType: eff.damageType, interval: eff.attackInterval,
    timer: 0, targetLimit: 1
  });
  state.world.add(id, "block", { capacity: eff.blockCount, blocked: [] });
  state.world.add(id, "tags", { tags: [...eff.tags] });
  return id;
}

export interface SpawnEnemyOptions {
  enemyId?: string;      // 缺省 en_slug
  row?: number;          // 缺省出生点行
  col?: number;          // 缺省出生点列
  spawnIndex?: number;   // 缺省 0
  waypoints?: { row: number; col: number }[]; // 覆盖默认路线
  hp?: number;           // 覆盖生命
}

/** 生成一名敌人实体（绕过波次系统），返回实体 id */
export function spawnEnemy(state: BattleState, opts: SpawnEnemyOptions = {}): number {
  const def = state.enemyDefs[opts.enemyId ?? "en_slug"];
  const spawnIndex = opts.spawnIndex ?? 0;
  const start = state.stage.spawns[spawnIndex];
  const waypoints = opts.waypoints ?? state.stage.paths[spawnIndex].map(p => ({ ...p }));
  const id = state.world.createEntity();
  state.world.add(id, "identity", { defId: def.id, faction: "enemy", name: def.name });
  state.world.add(id, "position", {
    row: opts.row ?? start.row,
    col: opts.col ?? start.col
  });
  state.world.add(id, "health", { hp: opts.hp ?? def.hp, maxHp: opts.hp ?? def.hp });
  state.world.add(id, "attack", {
    atk: def.atk, def: def.def, res: def.res,
    damageType: def.damageType, interval: def.attackInterval,
    timer: 0, targetLimit: 1
  });
  state.world.add(id, "enemyPath", {
    waypoints, index: 1, speed: def.speed,
    blockedBy: -1, blockWeight: def.blockWeight, leakDamage: def.leakDamage
  });
  state.world.add(id, "tags", { tags: [...(def.tags ?? [])] });
  return id;
}

/** 订阅并收集事件，返回事件数组（用于断言） */
export function collectEvents(bus: EventBus<GameEvent>): GameEvent[] {
  const events: GameEvent[] = [];
  const types: GameEvent["type"][] = [
    "enemySpawned", "operatorDeployed", "operatorRetreated", "attackLanded",
    "entityDied", "enemyBlocked", "enemyLeaked", "waveStarted", "dpChanged", "battleEnded"
  ];
  for (const t of types) bus.on(t, e => events.push(e));
  return events;
}

/** 按 enemyPath 组件读取敌人实体 id 列表 */
export function enemyIds(state: BattleState): number[] {
  return state.world.query("enemyPath");
}

/** 按 block 组件读取干员实体 id 列表 */
export function operatorIds(state: BattleState): number[] {
  return state.world.query("block");
}

export function pos(state: BattleState, id: number): { row: number; col: number } {
  return state.world.get(id, "position")!;
}

export function health(state: BattleState, id: number): CHealth {
  return state.world.get(id, "health")!;
}

/** 推进战斗时间并依次执行给定系统（模拟主循环） */
export function tick(
  state: BattleState,
  dt: number,
  systems: ((s: BattleState, dt: number) => void)[]
): void {
  state.time += dt;
  for (const sys of systems) sys(state, dt);
}
