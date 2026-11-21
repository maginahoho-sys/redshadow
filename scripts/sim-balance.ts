/**
 * sim-balance.ts —— M16 平衡回归模拟器（纯逻辑层，免浏览器）
 *
 * 策略：贪心自动部署 AI
 *   - 远程：全图高台按「射程覆盖路径格数」降序尝试部署
 *   - 近战：路径 35%/50%/65% 处的路点格按序尝试
 *   - 每 0.2s 尝试一轮；费用不足则等待
 * 输出：各关卡 × 多套编队/词条组合的胜负与剩余目标生命
 *
 * 用法：env -u NODE_OPTIONS npx tsx scripts/sim-balance.ts
 */
import type { BattleState, StageDef, OperatorDef, EnemyDef, RelicDef, RelicMod, TeamDef, Vec2, EffectiveStats, SquadMember } from "../src/contracts";
import { createBattle, stepBattle } from "../src/game/battle-glue";
import { canDeploy, deployOperator } from "../src/systems/deployment";
import { buildOperatorEffective, buildEnemyDefs, buildGlobals } from "../src/systems/relics";
import operatorsJson from "../src/data/operators.json";
import enemiesJson from "../src/data/enemies.json";
import relicsJson from "../src/data/relics.json";
import stagesJson from "../src/data/stages.json";
import runConfigJson from "../src/data/run-config.json";

const OPERATOR_LIST = operatorsJson as unknown as OperatorDef[];
const OPERATOR_DEFS: Record<string, OperatorDef> = Object.fromEntries(OPERATOR_LIST.map(o => [o.id, o]));
const ENEMY_LIST = enemiesJson as unknown as EnemyDef[];
const RELIC_LIST = relicsJson as unknown as RelicDef[];
const STAGES = stagesJson as unknown as StageDef[];
const RUN_CONFIG = runConfigJson as unknown as {
  runStart: { squadSizeBase: number; objectiveHp: number };
  teams: TeamDef[];
};

// ---- 部署 AI ----

/** 路径格集合（用于覆盖计数） */
function pathCellSet(stage: StageDef): Set<string> {
  const s = new Set<string>();
  for (const wp of stage.paths) for (const p of wp) s.add(`${p.row},${p.col}`);
  return s;
}

/** 远程候选高台格：按射程覆盖路径格数降序 */
function rangedSpots(state: BattleState): Vec2[] {
  const stage = state.stage;
  const cells = pathCellSet(stage);
  const spots: { cell: Vec2; cover: number }[] = [];
  for (let r = 0; r < stage.rows; r++) {
    for (let c = 0; c < stage.cols; c++) {
      if (stage.terrain[r][c] !== "h") continue;
      let cover = 0;
      for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1, 2]) {
        if (cells.has(`${r + dr},${c + dc}`)) cover++;
      }
      spots.push({ cell: { row: r, col: c }, cover });
    }
  }
  return spots.sort((a, b) => b.cover - a.cover).map(s => s.cell);
}

/** 近战候选格：路径 35%/50%/65% 处的路点 */
function meleeSpots(state: BattleState): Vec2[] {
  const out: Vec2[] = [];
  for (const wp of state.stage.paths) {
    for (const frac of [0.35, 0.5, 0.65]) {
      const p = wp[Math.floor((wp.length - 1) * frac)];
      out.push(p);
    }
  }
  return out;
}

/** 一轮部署尝试：远程填高台 → 近战堵路点（ready 且费用够才落） */
function tryDeploy(state: BattleState): void {
  const ranged = rangedSpots(state);
  const melee = meleeSpots(state);
  // 近战优先级：先锋（回费）> 重装 > 近卫 > 特种；远程全平等（按队伍顺序）
  const meleeOrder = ["vanguard", "defender", "guard", "specialist"];
  const ready: string[] = state.squad.filter((m: SquadMember) => m.state === "ready").map((m: SquadMember) => m.operatorId);
  const meleeIds = ready.filter((id: string) => OPERATOR_DEFS[id].placement === "melee")
    .sort((a: string, b: string) => meleeOrder.indexOf(OPERATOR_DEFS[a].profession) - meleeOrder.indexOf(OPERATOR_DEFS[b].profession));
  const rangedIds = ready.filter((id: string) => OPERATOR_DEFS[id].placement === "ranged");

  for (const id of rangedIds) {
    for (const cell of ranged) {
      if (canDeploy(state, id, cell).ok) { deployOperator(state, id, cell); break; }
    }
  }
  for (const id of meleeIds) {
    for (const cell of melee) {
      if (canDeploy(state, id, cell).ok) { deployOperator(state, id, cell); break; }
    }
  }
}

// ---- 模拟主循环 ----

interface SimResult {
  stage: string; squad: string; relics: string; result: string;
  objectiveHp: number; time: number; kills: number;
}

function simulate(stage: StageDef, squadIds: string[], relicIds: string[], extraMods: RelicMod[] = []): SimResult {
  const mods: RelicMod[] = [...extraMods];
  for (const rid of relicIds) {
    const relic = RELIC_LIST.find(r => r.id === rid);
    if (relic) mods.push(...(relic.mods as RelicMod[]));
  }
  const state = createBattle({
    stage,
    squadOperatorIds: [...squadIds],
    operatorDefs: OPERATOR_DEFS,
    enemyDefs: buildEnemyDefs(ENEMY_LIST, mods),
    effective: buildOperatorEffective(OPERATOR_LIST, mods) as Record<string, EffectiveStats>,
    globals: buildGlobals({
      dpRate: stage.dpRate, initialDp: stage.initialDp,
      objectiveHp: RUN_CONFIG.runStart.objectiveHp, tempObjectiveHp: 0,
      squadSize: RUN_CONFIG.runStart.squadSizeBase
    }, mods),
    seed: 42
  });

  const DT = 0.05;
  let deployTimer = 0;
  const maxTime = 900;
  while (state.status === "running" && state.time < maxTime) {
    stepBattle(state, DT);
    deployTimer += DT;
    if (deployTimer >= 0.2) { deployTimer = 0; tryDeploy(state); }
  }
  const kills = state.world.query("health").length; // 剩余实体（粗略）
  return {
    stage: stage.name,
    squad: squadIds.length === 3 ? "初始3人" : `${squadIds.length}人编队`,
    relics: relicIds.length === 0 ? "无" : `${relicIds.length}件`,
    result: state.status === "won" ? "胜" : state.status === "lost" ? "败" : "超时",
    objectiveHp: state.objectiveHp,
    time: Math.round(state.time),
    kills
  };
}

// ---- 场景矩阵 ----

const SQUAD_INIT = ["op_vanguard_01", "op_guard_01", "op_sniper_01"];           // startBattle 兜底前 3
const SQUAD_FULL = OPERATOR_LIST.slice(0, 8).map(o => o.id);                     // 8 人满编
const SQUAD_5 = ["op_vanguard_01", "op_defender_01", "op_guard_01", "op_sniper_01", "op_caster_01"];

const results: SimResult[] = [];
for (const stage of STAGES) {
  results.push(simulate(stage, SQUAD_INIT, []));
  results.push(simulate(stage, SQUAD_5, []));
  results.push(simulate(stage, SQUAD_FULL, []));
}
// BOSS 关 × 收藏品
const boss = STAGES.find(s => s.isBossStage);
if (boss) {
  results.push(simulate(boss, SQUAD_FULL, ["rl_dull_mask", "rl_wine_cup", "rl_blood_blade"]));
  results.push(simulate(boss, SQUAD_FULL, ["rl_hourglass", "rl_red_gauze", "rl_old_script", "rl_cracked_horn"]));
}

console.table(results.map(r => ({
  关卡: r.stage, 编队: r.squad, 收藏品: r.relics, 结果: r.result,
  剩余生命: r.objectiveHp, 耗时s: r.time, 场上实体: r.kills
})));
const losses = results.filter(r => r.result !== "胜");
console.log(losses.length === 0 ? "\n✓ 全部通关" : `\n✗ ${losses.length} 场未通：${losses.map(l => `${l.stage}/${l.squad}/${l.relics}=${l.result}(剩${l.objectiveHp},t=${l.time})`).join("; ")}`);
