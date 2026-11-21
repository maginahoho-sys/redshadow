/**
 * battle-hud.ts —— 战斗 HUD 与部署交互（M10 交付物）
 *
 * 职责：战斗界面全部 UI——顶部状态条（关卡名/目标生命/波次）、费用显示、
 * 底部干员部署栏（点卡片→点格子部署）、撤退面板、倍速/暂停控制、结算面板。
 *
 * 【交互约定】
 *  - 格子点击：复用 M8 网格的 setData("cell") 交互区，本模块监听 gameobjectdown；
 *  - 部署合法性：一律调 canDeploy，本模块不做任何地形/数值判断；
 *  - 倍速/暂停：写 registry 的 battleSpeed / battlePaused（M8 主循环读取）；
 *  - 结算完成：scene.events.emit("battle-finished", result)，M11 接管前为占位。
 */

import Phaser from "phaser";
import type { BattleState, Profession } from "../contracts";
import { canDeploy, deployOperator, retreatOperator } from "../systems/deployment";

/** 干员职业色表（与 sprites.ts 的 M9 色表一致，白名单不允许互相 import，故复制） */
const PROFESSION_COLOR: Record<Profession, number> = {
  vanguard: 0x6fc06f, guard: 0xe2703a, defender: 0xb7b7ff, sniper: 0xd8b13c,
  caster: 0xb26fe0, medic: 0x64d9c8, supporter: 0x6fa8e0, specialist: 0xd96f9c
};

const ENEMY_RED = 0xd04a4a;
const TEXT_MAIN = "#e8e2d9";
const TEXT_DIM = "#9c93b8";

/** 部署栏卡片尺寸（底栏从 y=630 起：画布 720，卡片高 90 恰好放下；SPEC 的 660 会截断卡片底部） */
const CARD_W = 120;
const CARD_H = 90;
const CARD_GAP = 10;
const BAR_Y = 630;

/** 单张部署卡片的表现数据 */
interface CardView {
  operatorId: string;
  root: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  costText: Phaser.GameObjects.Text;
  stateMask: Phaser.GameObjects.Rectangle;   // cooldown 灰蒙
  cdText: Phaser.GameObjects.Text;           // 冷却倒计时
  border: Phaser.GameObjects.Rectangle;      // deployed 高亮描边（复用同一矩形换描边色）
}

/**
 * 创建战斗 HUD（一次性挂到 scene 上；场景关闭时自动清理）。
 * 部署栏卡片在创建时生成一次，之后每帧只刷新状态。
 */
export function createBattleHud(scene: Phaser.Scene, state: BattleState): void {
  const ui: Phaser.GameObjects.GameObject[] = [];
  const unbinds: (() => void)[] = [];
  let deploySelecting: string | null = null;   // 部署模式中选中的干员 id
  let highlightCells: Phaser.GameObjects.Rectangle[] = [];
  let retreatPanel: Phaser.GameObjects.Container | null = null;
  let ended = false;

  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui.push(o); return o; };
  const text = (x: number, y: number, s: string, size: number, color = TEXT_MAIN) =>
    add(scene.add.text(x, y, s, { fontFamily: "sans-serif", fontSize: `${size}px`, color }));

  /** toast：居中提示文字，1.5s 后消失 */
  function toast(msg: string): void {
    const t = text(640, 600, msg, 16, "#f0b0b0").setOrigin(0.5).setDepth(900);
    scene.time.delayedCall(1500, () => t.destroy());
  }

  // 顶部状态条（关卡名由 M8 grid-scene 的 drawTitle 绘制，此处不重复）
  const waveText = text(1150, 24, "", 16, TEXT_DIM);
  text(1100, 24, "波次", 14, TEXT_DIM);

  /** 目标生命：小方块串（剩余亮红 / 已损失暗灰） */
  function drawObjectiveBlocks(): void {
    for (const o of ui.filter(o => o.getData("isHpBlock"))) o.destroy();
    const total = Math.ceil(state.globals.objectiveHp + state.globals.tempObjectiveHp);
    const remain = Math.max(0, Math.ceil(state.objectiveHp));
    for (let i = 0; i < total; i++) {
      const rect = scene.add.rectangle(560 + i * 24, 32, 18, 18, i < remain ? ENEMY_RED : 0x3a3a40);
      rect.setData("isHpBlock", true);
      ui.push(rect);
    }
  }

  // ============================================================
  // 费用显示（左下）
  // ============================================================

  const dpText = text(40, 560, "", 40);
  const dpRateText = text(40, 610, "", 14, TEXT_DIM);

  /** 当前有效费用回复速率 = globals.dpRate + Σ已部署先锋/词条的 dpBonusRate */
  function currentDpRate(): number {
    let rate = state.globals.dpRate;
    for (const m of state.squad) {
      if (m.state === "deployed") rate += state.effective[m.operatorId]?.dpBonusRate ?? 0;
    }
    return rate;
  }

  // ============================================================
  // 部署栏卡片
  // ============================================================

  const cards: CardView[] = [];

  function makeCard(index: number, operatorId: string): CardView {
    const def = state.operatorDefs[operatorId];
    const x = 40 + index * (CARD_W + CARD_GAP);
    const root = add(scene.add.container(x, BAR_Y));

    const border = scene.add.rectangle(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H).setStrokeStyle(2, PROFESSION_COLOR[def.profession]);
    const bg = scene.add.rectangle(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H, 0x1d1a26);
    const nameText = scene.add.text(CARD_W / 2, 22, def.name, { fontFamily: "sans-serif", fontSize: "15px", color: TEXT_MAIN }).setOrigin(0.5);
    const costText = scene.add.text(CARD_W / 2, 52, "", { fontFamily: "sans-serif", fontSize: "24px", color: "#e8c35a" }).setOrigin(0.5);
    const stateMask = scene.add.rectangle(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H, 0x000000, 0.55).setVisible(false);
    const cdText = scene.add.text(CARD_W / 2, CARD_H / 2, "", { fontFamily: "sans-serif", fontSize: "18px", color: TEXT_MAIN }).setOrigin(0.5).setVisible(false);
    root.add([border, bg, nameText, costText, stateMask, cdText]);

    root.setInteractive(new Phaser.Geom.Rectangle(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H), Phaser.Geom.Rectangle.Contains);
    return { operatorId, root, nameText, costText, stateMask, cdText, border };
  }

  state.squad.forEach((m, i) => cards.push(makeCard(i, m.operatorId)));

  // ============================================================
  // 部署模式：格子高亮 / 取消
  // ============================================================

  /** 进入部署模式：全部格子按 canDeploy 结果描边 */
  function enterDeployMode(operatorId: string): void {
    exitDeployMode();
    deploySelecting = operatorId;
    for (const child of scene.children.list) {
      const cell = child.getData("cell") as { row: number; col: number } | undefined;
      if (!cell || !(child instanceof Phaser.GameObjects.Rectangle)) continue;
      const ok = canDeploy(state, operatorId, cell).ok;
      const r = child as Phaser.GameObjects.Rectangle;
      r.setStrokeStyle(2, ok ? 0x4ad24a : 0x8a2a2a, ok ? 1 : 0.5);
      highlightCells.push(r);
    }
  }

  function exitDeployMode(): void {
    deploySelecting = null;
    for (const r of highlightCells) r.setStrokeStyle(0);
    highlightCells = [];
  }

  // ============================================================
  // 撤退面板
  // ============================================================

  function closeRetreatPanel(): void {
    retreatPanel?.destroy();
    retreatPanel = null;
  }

  /** 点击已有干员的格子 → 弹出撤退面板 */
  function openRetreatPanel(operatorId: string): void {
    closeRetreatPanel();
    const eff = state.effective[operatorId];
    retreatPanel = scene.add.container(640, 560).setDepth(950);
    const bg = scene.add.rectangle(0, 0, 300, 70, 0x1d1a26, 0.95).setStrokeStyle(1, 0x5d5340);
    const btn = scene.add.text(0, -12, "撤退（返还全部费用）", { fontFamily: "sans-serif", fontSize: "16px", color: "#e8c35a" }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const info = scene.add.text(0, 16, `${state.operatorDefs[operatorId].name} · 费用 ${eff.cost}`, { fontFamily: "sans-serif", fontSize: "12px", color: TEXT_DIM }).setOrigin(0.5);
    retreatPanel.add([bg, btn, info]);
    btn.on("pointerdown", () => {
      if (retreatOperator(state, operatorId)) {
        toast(`${state.operatorDefs[operatorId].name} 已撤退，返还 ${eff.cost} 费用`);
      }
      closeRetreatPanel();
    });
  }

  // ============================================================
  // 全局点击处理（格子 / 卡片 / 空白）
  // ============================================================

  /** 找出占据某格的干员（按 block 组件查实体 → SquadMember） */
  function operatorAtCell(row: number, col: number): string | null {
    for (const eid of state.world.query("block", "position")) {
      const p = state.world.get(eid, "position")!;
      if (p.row !== row || p.col !== col) continue;
      const m = state.squad.find(s => s.entityId === eid);
      if (m) return m.operatorId;
    }
    return null;
  }

  // 卡片点击（每个卡片独立监听）
  for (const card of cards) {
    card.root.on("pointerdown", () => {
      if (ended) return;
      closeRetreatPanel();
      const m = state.squad.find(s => s.operatorId === card.operatorId)!;
      if (m.state === "cooldown") { toast("该干员还在再部署冷却中"); return; }
      if (m.state === "deployed") { toast("该干员已在场上"); return; }
      // 进入/取消部署模式
      if (deploySelecting === card.operatorId) exitDeployMode();
      else enterDeployMode(card.operatorId);
    });
  }

  // 格子点击（复用 M8 的 setData("cell") 交互区）
  // 注意：gameobjectdown 每次只带一个 game object（不是数组）
  unbinds.push(() => scene.input.off("gameobjectdown", onCellDown));
  function onCellDown(_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject): void {
    if (ended) return;
    const cell = obj.getData("cell") as { row: number; col: number } | undefined;
    if (!cell) return;
    closeRetreatPanel();

    if (deploySelecting) {
      // 部署模式：点格子尝试部署
      const check = canDeploy(state, deploySelecting, cell);
      if (!check.ok) { toast(check.reason ?? "无法部署"); return; }
      const eid = deployOperator(state, deploySelecting, cell);
      if (eid === -1) { toast("部署失败"); return; }
      toast(`${state.operatorDefs[deploySelecting].name} 部署成功`);
      exitDeployMode();
      return;
    }
    // 非部署模式：点干员格子 → 撤退面板
    const opId = operatorAtCell(cell.row, cell.col);
    if (opId) openRetreatPanel(opId);
  }
  scene.input.on("gameobjectdown", onCellDown);

  // 点空白处（无格子无卡片）取消部署模式
  unbinds.push(() => scene.input.off("pointerdown", onBlankDown));
  function onBlankDown(_p: Phaser.Input.Pointer, overObjs: Phaser.GameObjects.GameObject[]): void {
    if (ended || !deploySelecting) return;
    // 点在格子或任一卡片上都不算空白（点卡片是切换选择，由卡片自己的 pointerdown 处理）
    const hitCell = overObjs.some(o => o.getData("cell"));
    const hitCard = overObjs.some(o => cards.some(c => c.root === o));
    if (!hitCell && !hitCard) exitDeployMode();
  }
  scene.input.on("pointerdown", onBlankDown);

  // ============================================================
  // 控制：暂停 / 倍速（右上角）
  // ============================================================

  const pauseBtn = text(1180, 60, "⏸", 22, TEXT_MAIN).setInteractive({ useHandCursor: true });
  pauseBtn.on("pointerdown", () => {
    const cur = scene.registry.get("battlePaused") === true;
    scene.registry.set("battlePaused", !cur);
  });
  const speedBtn = text(1220, 60, "×1", 22, TEXT_MAIN).setInteractive({ useHandCursor: true });
  speedBtn.on("pointerdown", () => {
    const cur = scene.registry.get("battleSpeed") ?? 1;
    scene.registry.set("battleSpeed", cur === 1 ? 2 : 1);
  });

  // ============================================================
  // 每帧刷新（挂场景 UPDATE 事件）
  // ============================================================

  function refresh(): void {
    // 费用与速率
    dpText.setText(`${Math.floor(state.dp)}`);
    dpRateText.setText(`费用回复 ${currentDpRate().toFixed(2)}/s`);
    // 波次
    waveText.setText(`${Math.min(state.waveIndex, state.stage.waves.length)} / ${state.stage.waves.length}`);
    // 目标生命方块
    drawObjectiveBlocks();
    // 卡片状态
    for (const card of cards) {
      const m = state.squad.find(s => s.operatorId === card.operatorId)!;
      const eff = state.effective[card.operatorId];
      card.costText.setText(`${eff.cost}`);
      const affordable = state.dp >= eff.cost;
      if (m.state === "cooldown") {
        card.stateMask.setVisible(true);
        card.cdText.setText(`${Math.ceil(m.cooldownRemaining)}`).setVisible(true);
        card.border.setStrokeStyle(2, 0x555560);
      } else {
        card.stateMask.setVisible(false);
        card.cdText.setVisible(false);
        if (m.state === "deployed") card.border.setStrokeStyle(2, PROFESSION_COLOR[state.operatorDefs[card.operatorId].profession], 1.2);
        else if (!affordable) card.border.setStrokeStyle(2, 0x555560, 0.7);
        else card.border.setStrokeStyle(2, PROFESSION_COLOR[state.operatorDefs[card.operatorId].profession]);
      }
      card.root.setAlpha(affordable || m.state !== "ready" ? 1 : 0.6);
    }
    // 暂停/倍速按钮文字
    pauseBtn.setText(scene.registry.get("battlePaused") === true ? "▶" : "⏸");
    speedBtn.setText(`×${scene.registry.get("battleSpeed") ?? 1}`);
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, refresh);
  unbinds.push(() => scene.events.off(Phaser.Scenes.Events.UPDATE, refresh));

  // ============================================================
  // 结算面板（battleEnded 订阅）
  // ============================================================

  const offEnd = state.bus.on("battleEnded", e => {
    ended = true;
    exitDeployMode();
    closeRetreatPanel();
    const mask = add(scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.65).setDepth(990));
    void mask;
    const win = e.result === "won";
    const title = add(text(640, 280, win ? "作战胜利" : "作战失败", 56, win ? "#e8c35a" : "#d04a4a")).setOrigin(0.5).setDepth(991);
    void title;
    const detail = add(text(640, 340, `本关耗时 ${Math.floor(state.time)} 秒 · 通过波次 ${state.waveIndex}/${state.stage.waves.length}`, 18, TEXT_MAIN)).setOrigin(0.5).setDepth(991);
    void detail;
    const backBtn = add(text(640, 420, "返回节点地图", 20, "#e8c35a")).setOrigin(0.5).setDepth(991)
      .setInteractive({ useHandCursor: true });
    backBtn.on("pointerdown", () => scene.events.emit("battle-finished", e.result));
  });
  unbinds.push(offEnd);

  // 场景关闭时清理全部 HUD 对象与监听
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const fn of unbinds) fn();
    for (const o of ui) o.destroy();
    ui.length = 0;
  });
}
