/**
 * grid-scene.ts —— 战斗网格场景（M8 交付物之一）
 *
 * 职责：
 *  1. 渲染关卡网格（地形色块 + 出生点/防御点描边 + 关卡名）。
 *  2. 每格注册交互区（setData("cell", {row, col})），供 M10 部署点击使用。
 *  3. 驱动战斗主循环：update 中调用 stepBattle（倍速/暂停从 registry 读取）。
 *
 * 【边界约定】本模块不画干员/敌人（M9 负责），不画 HUD（M10 负责）；
 * 不含任何战斗规则逻辑，数值判断一概调系统函数。
 */

import Phaser from "phaser";
import type { BattleState } from "../contracts";
import { createBattle, stepBattle, type BattleSetupOptions } from "../game/battle-glue";
import { createSpriteLayer, type SpriteLayer } from "./sprites";
import { createBattleHud } from "./battle-hud";

/** 格子像素尺寸（M9 精灵定位 / M10 HUD 依赖此常量） */
export const CELL = 96;

/** 网格绘制原点（左上角像素坐标） */
const ORIGIN_X = 40;
const ORIGIN_Y = 120;

/** 地形编码 → 填充色 */
const TERRAIN_COLOR: Record<string, number> = {
  ".": 0x17151f, // 空地
  "r": 0x3d3a47, // 地面道路（近战可部署，敌人通行）
  "h": 0x5d5340, // 高台（远程可部署）
  "#": 0x101014, // 墙
  "S": 0x3d3a47, // 出生点（底色同道路，另加描边）
  "G": 0x3d3a47  // 防御点（底色同道路，另加描边）
};

/** 出生点/防御点描边色 */
const SPAWN_STROKE = 0x4a7ef0;
const GOAL_STROKE = 0xe24b4a;

/**
 * 战斗场景（key = "Battle"）。
 * 启动方式：scene.start("Battle", { battle: BattleState })；
 * 也支持直接传装配参数 BattleSetupOptions，由场景内部调用 createBattle。
 */
export class BattleScene extends Phaser.Scene {
  private battle!: BattleState;
  private sprites!: SpriteLayer;

  constructor() {
    super("Battle");
  }

  create(): void {
    const data = this.scene.settings.data as
      | { battle: BattleState }
      | { setup: BattleSetupOptions }
      | undefined;

    if (!data) {
      // 无参数启动（如独立预览）：给出提示文本
      this.add.text(640, 360, "BattleScene 需要 scene.start(\"Battle\", { battle | setup }) 启动", {
        fontFamily: "sans-serif", fontSize: "16px", color: "#e8e2d9"
      }).setOrigin(0.5);
      return;
    }

    // 兼容两种启动参数：现成 BattleState 或 BattleSetupOptions
    this.battle = "battle" in data
      ? data.battle
      : createBattle((data as { setup: BattleSetupOptions }).setup);

    this.cameras.main.setBackgroundColor("#14121a");
    this.drawGrid();
    this.drawTitle();

    // M9 精灵层：干员/敌人火柴人 + 血条 + 事件表现
    this.sprites = createSpriteLayer(this, this.battle);
    // M10 HUD：状态条/部署栏/倍速暂停/结算面板
    createBattleHud(this, this.battle);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.sprites.destroy());

    // 事件冒烟：把关键事件打到 console，便于 M8 手动验收（M9/M10 将接管表现）
    this.battle.bus.on("enemySpawned", e => {
      console.log(`[M8] 敌人出生 defId=${e.defId} 实体=${e.entityId} 场上=${this.battle.world.count()}`);
    });
    this.battle.bus.on("battleEnded", e => {
      console.log(`[M8] 战斗结束 result=${e.result}`);
    });
  }

  /** 渲染地形网格：每格一个矩形 + 交互区 */
  private drawGrid(): void {
    const { terrain } = this.battle.stage;
    for (let row = 0; row < terrain.length; row++) {
      for (let col = 0; col < terrain[row].length; col++) {
        const ch = terrain[row][col];
        const x = ORIGIN_X + col * CELL;
        const y = ORIGIN_Y + row * CELL;

        const rect = this.add.rectangle(
          x + CELL / 2, y + CELL / 2, CELL, CELL, TERRAIN_COLOR[ch] ?? TERRAIN_COLOR["."]
        );

        // 出生点/防御点描边标识
        if (ch === "S") rect.setStrokeStyle(2, SPAWN_STROKE);
        if (ch === "G") rect.setStrokeStyle(2, GOAL_STROKE);

        // 注册交互区，M10 部署点击依赖 setData("cell") 约定
        rect.setInteractive();
        rect.setData("cell", { row, col });
      }
    }
  }

  /** 左上角关卡名 */
  private drawTitle(): void {
    this.add.text(ORIGIN_X, 60, this.battle.stage.name, {
      fontFamily: "sans-serif", fontSize: "24px", color: "#e8e2d9"
    });
  }

  update(_time: number, delta: number): void {
    if (!this.battle) return;

    // 暂停开关（M10 HUD 写 registry）
    if (this.registry.get("battlePaused") === true) return;

    // delta 上限截断到 100ms，防止切页回来跳帧破坏战斗
    const clamped = Math.min(delta, 100) / 1000;
    // 倍速（M10 HUD 写 registry，缺省 1）
    const speed = this.registry.get("battleSpeed") ?? 1;

    stepBattle(this.battle, clamped * speed);
    // 精灵层同步（暂停时也调用，保持血条/连线与状态一致）
    this.sprites.update(clamped * speed);
  }
}
