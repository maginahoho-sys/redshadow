import Phaser from "phaser";
import { BattleScene } from "./render/grid-scene";
import type { BattleSetupOptions } from "./game/battle-glue";
import type { OperatorDef, EnemyDef, StageDef, EffectiveStats, EffectiveGlobals } from "./contracts";

import operatorsJson from "./data/operators.json";
import enemiesJson from "./data/enemies.json";
import stagesJson from "./data/stages.json";

/**
 * 临时入口（M8 手动验收用）：
 * 用示例数据装配第一关战斗并启动 BattleScene。
 * M9/M10 合入后此文件将改为正式启动流程（肉鸽界面 → 战斗场景跳转）。
 */

const OPERATOR_DEFS = Object.fromEntries(
  (operatorsJson as unknown as OperatorDef[]).map(o => [o.id, o])
);
const ENEMY_DEFS = Object.fromEntries(
  (enemiesJson as unknown as EnemyDef[]).map(e => [e.id, e])
);
const STAGE = (stagesJson as unknown as StageDef[])[0];

/** 基准有效属性（无词条；M4 交付后改用 buildOperatorEffective） */
function baseEffective(op: OperatorDef): EffectiveStats {
  return {
    cost: op.cost, hp: op.hp, atk: op.atk, def: op.def, res: op.res,
    attackInterval: op.attackInterval, blockCount: op.blockCount,
    damageType: op.damageType, range: op.range,
    redeployCooldown: op.redeployCooldown,
    dpBonusRate: op.dpBonusRate ?? 0, tags: [...(op.tags ?? [])]
  };
}

const effective: Record<string, EffectiveStats> = {};
for (const id of Object.keys(OPERATOR_DEFS)) effective[id] = baseEffective(OPERATOR_DEFS[id]);

const globals: EffectiveGlobals = {
  dpRate: STAGE.dpRate,
  initialDp: STAGE.initialDp,
  objectiveHp: STAGE.objectiveHp,
  tempObjectiveHp: 0,
  squadSize: 4
};

// 初始编队：全部干员上阵（临时验收用）
const setup: BattleSetupOptions = {
  stage: STAGE,
  squadOperatorIds: Object.keys(OPERATOR_DEFS),
  operatorDefs: OPERATOR_DEFS,
  enemyDefs: ENEMY_DEFS,
  effective,
  globals,
  seed: 20261121
};

/** M8 引导场景：立即携带装配参数跳入战斗场景 */
class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    this.scene.start("Battle", { setup });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14121a",
  scene: [BootScene, BattleScene]
});
