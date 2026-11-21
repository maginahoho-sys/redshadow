/**
 * M11 run-bootstrap —— 探索局的创建与节点奖励结算（纯逻辑，不碰 Phaser）
 *
 * 说明：pickStage 需要关卡池，但 SPEC 白名单未含数据文件——
 * 这里 import stages.json（数据驱动），是对白名单的最小偏离，已获主会话确认。
 */
import {
  createRng,
  type NodeType, type RunState, type Rng, type StageDef, type RelicMod, type TeamDef
} from "../contracts";
import { runStartFrom } from "../systems/relics";
import { generateNodeMap, type FloorConfig } from "../meta/node-map";
import runConfigJson from "../data/run-config.json";
import stagesJson from "../data/stages.json";

/** 探索局全局配置（run-config.json） */
const RUN_CONFIG = runConfigJson as unknown as {
  runStart: {
    hope: number; hopeCap: number; ingots: number; objectiveHp: number;
    objectiveHpCap: number; squadSizeBase: number; initialSquad: string[]; initialRelics: string[];
  };
  floors: FloorConfig[];
  teams: TeamDef[];
};

const STAGES = stagesJson as unknown as StageDef[];

/** 探索胜利标记（写入 eventLog，RogueScene 据此切胜利结算） */
export const RUN_WIN_MARK = "runComplete:win";

/** 按分队 id 查分队定义（找不到退回第一个） */
function findTeam(teamId: string): TeamDef {
  return RUN_CONFIG.teams.find(t => t.id === teamId) ?? RUN_CONFIG.teams[0];
}

/** 楼层下标（1 起）→ FloorConfig；越界退回最后一层 */
function floorCfg(floor: number): FloorConfig {
  const i = Math.min(Math.max(floor - 1, 0), RUN_CONFIG.floors.length - 1);
  return RUN_CONFIG.floors[i];
}

/**
 * 创建探索局：runStart 基准 + 分队词条 + 生成第一层节点图。
 */
export function createRun(seed: number, teamId: string): RunState {
  const team = findTeam(teamId);
  const mods = team.mods as RelicMod[];
  const start = runStartFrom(RUN_CONFIG.runStart, mods);
  const rng = createRng(seed);

  return {
    seed,
    teamId: team.id,
    floor: 1,
    nodeMap: generateNodeMap(1, floorCfg(1), rng),
    currentNodeId: null,                    // null = 处于 start 前的分叉选择
    visitedNodeIds: [],
    hope: start.hope,
    hopeCap: start.hopeCap,
    ingots: start.ingots,
    objectiveHp: start.objectiveHp,
    objectiveHpCap: RUN_CONFIG.runStart.objectiveHpCap,
    squad: [...RUN_CONFIG.runStart.initialSquad],
    reserve: [],
    promoted: {},
    relics: [...RUN_CONFIG.runStart.initialRelics],
    recruitTickets: [],
    recruitPools: {},
    eventLog: []
  };
}

/** 节点奖励表：希望 / 源石锭 / 收藏品概率（rng 可复现） */
interface RewardRow {
  hope: (rng: Rng) => number;
  ingots: (rng: Rng) => number;
  relicChance: number;
}
const REWARD_TABLE: Partial<Record<NodeType, RewardRow>> = {
  battle: {
    hope: rng => 1 + rng.int(0, 1), ingots: rng => 6 + rng.int(0, 6), relicChance: 0.25
  },
  emergencyBattle: {
    hope: rng => 2 + rng.int(0, 1), ingots: rng => 10 + rng.int(0, 8), relicChance: 0.4
  },
  boss: {
    hope: () => 3, ingots: rng => 20 + rng.int(0, 10), relicChance: 1.0
  }
};

/**
 * 节点完成后的奖励：希望/源石锭/概率收藏品；紧急作战加成；boss 过层。
 * 非战斗节点返回零奖励。
 */
export function nodeRewards(
  state: RunState, nodeType: NodeType, rng: Rng, relicIds: string[]
): { hope: number; ingots: number; relicId?: string } {
  const row = REWARD_TABLE[nodeType];
  if (!row) return { hope: 0, ingots: 0 };

  const hope = row.hope(rng);
  const ingots = row.ingots(rng);
  let relicId: string | undefined;
  if (relicIds.length > 0 && rng.next() < row.relicChance) {
    relicId = rng.pick(relicIds);
    state.relics.push(relicId);
    state.eventLog.push(`获得收藏品 ${relicId}（${nodeType} 奖励）`);
  }
  state.eventLog.push(`完成 ${nodeType} 节点：+${hope} 希望 +${ingots} 源石锭`);
  return { hope, ingots, relicId };
}

/**
 * 从关卡包按节点类型挑一个关卡（boss 节点挑 isBossStage）。
 * emergency 优先带"紧急"标记的关卡（无标记则同池）；无合适关卡返回第一个。
 */
export function pickStage(rng: Rng, nodeType: NodeType): StageDef {
  if (nodeType === "boss") {
    const bosses = STAGES.filter(s => s.isBossStage === true);
    return bosses.length > 0 ? rng.pick(bosses) : STAGES[0];
  }
  const pool = STAGES.filter(s => s.isBossStage !== true);
  if (nodeType === "emergencyBattle") {
    const marked = pool.filter(s => s.name.includes("紧急"));
    if (marked.length > 0) return rng.pick(marked);
  }
  return pool.length > 0 ? rng.pick(pool) : STAGES[0];
}

/**
 * 打完 boss 后推进层：floor+1 生成新节点图，目标生命 +1（不超上限）；
 * 越过最后一层 → 探索胜利标记（eventLog）。
 */
export function advanceFloor(state: RunState, rng: Rng): void {
  state.floor += 1;
  if (state.floor > RUN_CONFIG.floors.length) {
    state.eventLog.push(RUN_WIN_MARK);
    return;
  }
  state.nodeMap = generateNodeMap(state.floor, floorCfg(state.floor), rng);
  state.currentNodeId = null;
  state.visitedNodeIds = [];
  state.objectiveHp = Math.min(state.objectiveHpCap, state.objectiveHp + 1);
  state.eventLog.push(`进入第 ${state.floor} 层：${floorCfg(state.floor).floorName}`);
}
