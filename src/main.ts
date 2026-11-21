/**
 * RedShadow 正式入口（M16 起）：
 * BootScene（标题画面）→ RogueScene（分队选择 → 节点图 → 商店/事件/招募）⇄ BattleScene（战斗）。
 * Boot 为首个场景自动启动；战斗结果经 battle-finished 事件回 Rogue。
 */
import Phaser from "phaser";
import { BootScene } from "./render/boot-scene";
import { RogueScene } from "./render/rogue-ui";
import { BattleScene } from "./render/grid-scene";
import { canDeploy, deployOperator } from "./systems/deployment";
import { stepBattle } from "./game/battle-glue";
import { saveRun } from "./meta/save";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14121a",
  scene: [BootScene, RogueScene, BattleScene]
});

// ---- 调试口（自动化测试用）----
type DebugBattleState = Parameters<typeof canDeploy>[0];
const w = window as unknown as {
  __game: Phaser.Game;
  __battleApi: {
    canDeploy: typeof canDeploy;
    deployOperator: typeof deployOperator;
    stepBattle: typeof stepBattle;
    saveRun: typeof saveRun;
    /** 取活动战斗状态（无战斗返回 null） */
    battle: () => DebugBattleState | null;
  };
};
w.__game = game;
w.__battleApi = {
  canDeploy,
  deployOperator,
  stepBattle,
  saveRun,
  battle: () => {
    const scene = game.scene.getScene("Battle");
    const active = scene ? game.scene.isActive("Battle") : false;
    // battle 为 BattleScene 私有字段，运行时可达；inactive 场景返回 null
    return active ? (scene as unknown as { battle?: DebugBattleState }).battle ?? null : null;
  }
};
