/**
 * waves.ts —— M5 波次调度与胜负判定
 *
 * 职责：按关卡定义按时出怪、管理波次推进（time/clear 两种触发）、判定战斗胜负。
 * 纯逻辑层：不 import Phaser，不使用 Math.random。
 *
 * 【pendingSpawns 语义（由验收用例反推，两种触发不同）】
 * - time 触发波：开始时全部条目入队（含已到点项），出生后【保留】——
 *   pendingSpawns 是本波完整排期表；已出生项用"已出生集合"按对象引用标记，
 *   保证每项只出生一次（到点即补出生，迟到的波开始时当场补齐）。
 * - clear 触发波：开始时已到点（at <= state.time）的条目【当场出生、不入队】，
 *   只有未来条目入队。
 * - pendingSpawns 始终按 at 升序。
 *
 * 【排期锚点（两种触发统一）】锚点 = 上一波排期时刻 + delay（排期链，第一波记 0）。
 * - time 触发：state.time > 锚点 即开始（严格大于——恰好等于的时刻本帧不开）；
 * - clear 触发：条件（场上无存活敌人 且 排期已全部出完）每帧成立时累计
 *   clearElapsed（条件不成立立即清零），累计超过 delay 即开始。
 *
 * 每帧最多开始一波；胜负判定只从 running 进入终局且只发一次 battleEnded。
 */

import type { BattleState, EnemyDef, PendingSpawn } from "../contracts";

/** 每场战斗的波次运行时进度（按 BattleState 实例隔离，不跨战斗泄漏） */
interface WaveRuntime {
  /** 上一波的排期开始时刻（排期链）；第一波记 0 */
  lastSched: number;
  /** 已出生排期项集合（按对象引用标记，排序插入安全） */
  spawned: Set<PendingSpawn>;
  /** clear 触发条件的连续成立时长（秒；条件不成立立即清零） */
  clearElapsed: number;
}

/** 运行时进度存取（WeakMap：战斗状态被丢弃后自动回收） */
const runtimes = new WeakMap<BattleState, WaveRuntime>();

function runtimeOf(state: BattleState): WaveRuntime {
  let rt = runtimes.get(state);
  if (!rt) {
    rt = { lastSched: 0, spawned: new Set(), clearElapsed: 0 };
    runtimes.set(state, rt);
  }
  return rt;
}

/** 排期是否已全部出完（已出生数 >= 队列长度；队列被清空视为出完） */
function allSpawned(state: BattleState, rt: WaveRuntime): boolean {
  return rt.spawned.size >= state.pendingSpawns.length;
}

/**
 * 生成敌人实体——组件构造与 tests/helpers.ts 的 spawnEnemy 完全一致，
 * 保证 M1/M2/M5 在同一场战斗中共享组件约定。
 * 数值取 state.enemyDefs[enemyId]（已是词条结算后的最终值）。
 */
function spawnEnemyEntity(state: BattleState, enemyId: string, spawnIndex: number): void {
  const def: EnemyDef | undefined = state.enemyDefs[enemyId];
  const start = state.stage.spawns[spawnIndex];
  const path = state.stage.paths[spawnIndex];
  if (!def || !start || !path) return; // 数据缺失，防御性跳过

  const id = state.world.createEntity();
  state.world.add(id, "identity", { defId: def.id, faction: "enemy", name: def.name });
  state.world.add(id, "position", { row: start.row, col: start.col });
  state.world.add(id, "health", { hp: def.hp, maxHp: def.hp });
  state.world.add(id, "attack", {
    atk: def.atk, def: def.def, res: def.res,
    damageType: def.damageType, interval: def.attackInterval,
    timer: 0, targetLimit: 1
  });
  state.world.add(id, "enemyPath", {
    waypoints: path.map(p => ({ row: p.row, col: p.col })),
    index: 1, speed: def.speed,
    blockedBy: -1, blockWeight: def.blockWeight, leakDamage: def.leakDamage
  });
  state.world.add(id, "tags", { tags: [...(def.tags ?? [])] });

  state.bus.emit({ type: "enemySpawned", entityId: id, defId: enemyId, spawnIndex });
}

/** 开始下一波：发事件、按锚点生成排期并入队/当场出生、推进 waveIndex */
function startWave(state: BattleState, rt: WaveRuntime, anchor: number): void {
  const wave = state.stage.waves[state.waveIndex];
  state.bus.emit({ type: "waveStarted", index: state.waveIndex });

  // 生成本波全部条目的排期：at = 锚点 + delay + k*interval
  const scheduled: PendingSpawn[] = [];
  for (const entry of wave.entries) {
    for (let k = 0; k < entry.count; k++) {
      scheduled.push({
        enemyId: entry.enemyId,
        spawnIndex: entry.spawn,
        at: anchor + entry.delay + k * entry.interval
      });
    }
  }

  if (wave.trigger === "time") {
    // time 触发：完整排期表入队（含已到点项，稍后由出怪阶段按序补出生）
    state.pendingSpawns.push(...scheduled);
  } else {
    // clear 触发：已到点条目当场出生不入队；未来条目入队
    for (const item of scheduled) {
      if (item.at <= state.time) {
        spawnEnemyEntity(state, item.enemyId, item.spawnIndex);
        rt.spawned.add(item);
      } else {
        state.pendingSpawns.push(item);
      }
    }
  }
  // 保持整体升序
  state.pendingSpawns.sort((a, b) => a.at - b.at);

  rt.lastSched = anchor;
  rt.clearElapsed = 0;
  state.waveTimer = 0;
  state.waveIndex += 1;
  // 本波全部条目已处理完毕（入队或当场出生）
  state.currentWaveAllSpawned = true;
}

/**
 * 帧更新：波次推进 + 待出生队列出怪。
 * 帧内顺序：波次推进（至多一波）→ waveTimer 累计 → 出怪。
 */
export function waveSystem(state: BattleState, dt: number): void {
  const rt = runtimeOf(state);

  // 1) 波次推进：考察下一波，至多开始一波
  if (state.waveIndex < state.stage.waves.length) {
    const wave = state.stage.waves[state.waveIndex];
    if (wave.trigger === "time") {
      // 排期链锚点；严格大于才开（恰好等于不开）
      rt.clearElapsed = 0;
      if (state.time > rt.lastSched + wave.delay) {
        startWave(state, rt, rt.lastSched + wave.delay);
      }
    } else {
      // clear：场上无存活敌人 且 排期已全部出完，条件连续成立累计 delay 秒后开始
      const fieldEmpty = state.world.query("enemyPath").length === 0;
      if (fieldEmpty && allSpawned(state, rt)) {
        rt.clearElapsed += dt;
      } else {
        rt.clearElapsed = 0;
      }
      if (rt.clearElapsed > wave.delay) {
        startWave(state, rt, rt.lastSched + wave.delay);
      }
    }
  }

  // 2) 当前波开始后的累计时间（HUD/调试用；开始帧已在 startWave 中清零）
  state.waveTimer += dt;

  // 3) 出怪：按序出生所有已到点且未出生的排期项（集合标记保证只出生一次）
  for (const item of state.pendingSpawns) {
    if (rt.spawned.has(item)) continue;
    if (item.at > state.time) break; // 升序队列，后面更晚
    spawnEnemyEntity(state, item.enemyId, item.spawnIndex);
    rt.spawned.add(item);
  }
}

/**
 * 胜负判定：只从 running 状态进入终局，只发一次 battleEnded。
 * - objectiveHp <= 0 → lost（优先判定）；
 * - 所有波次已开始 且 场上无敌人 且 排期全部出完 → won。
 */
export function checkBattleEnd(state: BattleState): void {
  if (state.status !== "running") return;

  if (state.objectiveHp <= 0) {
    state.status = "lost";
    state.bus.emit({ type: "battleEnded", result: "lost" });
    return;
  }

  const rt = runtimeOf(state);
  const noEnemies = state.world.query("enemyPath").length === 0;
  if (state.waveIndex >= state.stage.waves.length && noEnemies && allSpawned(state, rt)) {
    state.status = "won";
    state.bus.emit({ type: "battleEnded", result: "won" });
  }
}
