/**
 * RedShadow 正式入口（M11 起）：
 * RogueScene（分队选择 → 节点图 → 商店/事件/招募）↔ BattleScene（战斗）。
 * 首个场景自动启动，无需 Boot 引导。
 */
import Phaser from "phaser";
import { RogueScene } from "./render/rogue-ui";
import { BattleScene } from "./render/grid-scene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14121a",
  scene: [RogueScene, BattleScene]
});

// 调试口：console / 自动化测试可用 __game 取场景与状态
(window as unknown as { __game: Phaser.Game }).__game = game;
