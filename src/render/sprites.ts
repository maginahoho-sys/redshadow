/**
 * sprites.ts —— 精灵与血条层（M9 交付物）
 *
 * 职责：把 BattleState 里的实体画成火柴人（纯 Graphics，无贴图），
 * 订阅战斗事件驱动表现（出生/部署/受击/死亡/阻挡/漏怪），每帧同步位置与血条。
 *
 * 【边界约定】本模块只做「状态 → 画面」映射，不含任何战斗规则逻辑；
 * 数值一律读实体组件（CPosition/CHealth/CEnemyPath），事件只当触发器。
 */

import Phaser from "phaser";
import type { BattleState, Faction, Profession } from "../contracts";
import { CELL } from "./grid-scene";

/** 网格原点（与 grid-scene.ts 的 ORIGIN_X/ORIGIN_Y 约定一致：M8 定值 40/120） */
const ORIGIN_X = 40;
const ORIGIN_Y = 120;

/** 干员职业描边色 */
const PROFESSION_COLOR: Record<Profession, number> = {
  vanguard: 0x6fc06f, guard: 0xe2703a, defender: 0xb7b7ff, sniper: 0xd8b13c,
  caster: 0xb26fe0, medic: 0x64d9c8, supporter: 0x6fa8e0, specialist: 0xd96f9c
};

/** 敌人统一猩红 / 血条色 / 阻挡连线色 */
const ENEMY_COLOR = 0xd04a4a;
const BAR_BG = 0x333333;
const BLOCK_LINE_COLOR = 0xb7b7ff;

/** 格坐标 → 像素（脚底中心）。+CELL/2 居中、+CELL-8 贴格底，来源：M8 网格原点 (40,120) */
function cellToPx(row: number, col: number): { x: number; y: number } {
  return { x: ORIGIN_X + col * CELL + CELL / 2, y: ORIGIN_Y + row * CELL + (CELL - 8) };
}

/** 单个实体的表现数据 */
interface EntityView {
  entityId: number;
  faction: Faction;
  container: Phaser.GameObjects.Container;
  barFg: Phaser.GameObjects.Rectangle;   // 血条前景（scaleX 按 hp/maxHp）
  badge: Phaser.GameObjects.Rectangle;   // 被阻挡角标「■」（默认隐藏）
  operatorId?: string;                   // 干员用（operatorRetreated 事件按此查找）
}

/** 阻挡连线 */
interface BlockLine {
  gfx: Phaser.GameObjects.Graphics;
  enemyId: number;
  blockerId: number;
}

export interface SpriteLayer {
  /** 每帧同步：实体位置、血条、阻挡连线 */
  update(dt: number): void;
  /** 取消全部订阅并销毁全部容器 */
  destroy(): void;
}

/**
 * 创建精灵层。
 * @param scene  BattleScene（ tweens/加对象都挂它 ）
 * @param state  战斗状态（读 world 组件 + 订阅 bus 事件）
 */
export function createSpriteLayer(scene: Phaser.Scene, state: BattleState): SpriteLayer {
  const views = new Map<number, EntityView>();          // entityId → 表现
  const opIds = new Map<string, number>();              // operatorId → entityId
  const lines = new Map<number, BlockLine>();           // enemyId → 阻挡连线
  const unsubs: (() => void)[] = [];

  // ------------------------------------------------------------
  // 火柴人绘制（容器锚点 = 脚底中心 (0,0)，向上为 -y）
  // ------------------------------------------------------------
  // 几何：腿 (0,0)→(∓7,-12)；躯干 (0,-12)→(0,-30)；头圆心 (0,-37) r=7；
  //       双臂肩点 (0,-26)，长 12px；血条 y=-58（头顶 -44 再上 14px）。

  /** 画火柴人到指定 Graphics（干员双臂朝 +x（敌人来向），敌人双臂对称） */
  function drawStickman(g: Phaser.GameObjects.Graphics, color: number, isOperator: boolean): void {
    g.lineStyle(2, color, 1);
    // 双腿
    g.lineBetween(0, 0, -7, -12);
    g.lineBetween(0, 0, 7, -12);
    // 躯干（同色 2px 粗线突出）
    g.lineBetween(0, -12, 0, -30);
    // 双臂：干员朝 +col 方向（伸向前方），敌人左右对称
    if (isOperator) {
      g.lineBetween(0, -24, 10, -19);
      g.lineBetween(0, -28, 10, -33);
    } else {
      g.lineBetween(0, -26, -9, -20);
      g.lineBetween(0, -26, 9, -20);
    }
    // 头（描边圆）
    g.strokeCircle(0, -37, 7);
  }

  /** 在容器里加血条（背景槽 + 前景条，前景 origin 左中便于 scaleX 缩放） */
  function addHealthBar(container: Phaser.GameObjects.Container, fgColor: number): Phaser.GameObjects.Rectangle {
    container.add(scene.add.rectangle(-18, -58, 36, 4, BAR_BG).setOrigin(0, 0.5));
    const fg = scene.add.rectangle(-18, -58, 36, 4, fgColor).setOrigin(0, 0.5);
    container.add(fg);
    return fg;
  }

  /** 创建干员容器（职业配色；部署时 0.15s 落地放大动效由事件处理） */
  function makeOperatorView(entityId: number, operatorId: string): EntityView {
    const def = state.operatorDefs[operatorId];
    const color = PROFESSION_COLOR[def?.profession ?? "guard"];
    const container = scene.add.container(0, 0);
    // 立即定位到实体当前坐标（避免从 (0,0) 飘入）
    const p0 = state.world.get(entityId, "position");
    if (p0) {
      const px = cellToPx(p0.row, p0.col);
      container.setPosition(px.x, px.y);
    }
    const g = scene.add.graphics();
    drawStickman(g, color, true);
    container.add(g);
    const barFg = addHealthBar(container, color);
    scene.add.existing(container);
    const view: EntityView = { entityId, faction: "operator", container, barFg, badge: null!, operatorId };
    views.set(entityId, view);
    opIds.set(operatorId, entityId);
    return view;
  }

  /** 创建敌人容器（猩红；fast 双头；blockWeight≥3 的 BOSS 放大 1.8 + 三角高帽） */
  function makeEnemyView(entityId: number): EntityView {
    const tags = state.world.get(entityId, "tags")?.tags ?? [];
    const path = state.world.get(entityId, "enemyPath");
    const isBoss = (path?.blockWeight ?? 0) >= 3;

    const container = scene.add.container(0, 0);
    // 立即定位到出生点（避免从画面左上角 (0,0) 飘入）
    const p0 = state.world.get(entityId, "position");
    if (p0) {
      const px = cellToPx(p0.row, p0.col);
      container.setPosition(px.x, px.y);
    }
    const g = scene.add.graphics();
    if (isBoss) container.setScale(1.8);
    drawStickman(g, ENEMY_COLOR, false);
    // fast 标签：双头（旁边再画一只圆）
    if (tags.includes("fast")) g.strokeCircle(6, -37, 7);
    // BOSS 高帽：头顶三角
    if (isBoss) {
      g.lineStyle(2, ENEMY_COLOR, 1);
      g.strokeTriangle(-8, -46, 8, -46, 0, -58);
    }
    container.add(g);
    const barFg = addHealthBar(container, ENEMY_COLOR);
    // 被阻挡角标「■」（默认隐藏，update 里按 enemyPath.blockedBy 显隐）
    const badge = scene.add.rectangle(24, -58, 6, 6, BLOCK_LINE_COLOR).setVisible(false);
    container.add(badge);
    scene.add.existing(container);

    const view: EntityView = { entityId, faction: "enemy", container, barFg, badge };
    views.set(entityId, view);
    // 0.2s 淡入
    container.setAlpha(0);
    scene.tweens.add({ targets: container, alpha: 1, duration: 200 });
    return view;
  }

  // ------------------------------------------------------------
  // 实体补建 / 表现清理
  // ------------------------------------------------------------

  /** 按 identity 组件补建一个实体的表现（createSpriteLayer 时对已有实体调用） */
  function ensureView(entityId: number): EntityView | undefined {
    if (views.has(entityId)) return views.get(entityId);
    const identity = state.world.get(entityId, "identity");
    if (!identity) return undefined;
    return identity.faction === "operator"
      ? makeOperatorView(entityId, identity.defId)
      : makeEnemyView(entityId);
  }

  /** 淡出并移除容器（死亡/撤退共用收尾） */
  function fadeOut(view: EntityView, spin: boolean): void {
    const tween = { targets: view.container, alpha: 0, duration: 300, onComplete: () => view.container.destroy() };
    if (spin) (tween as Phaser.Types.Tweens.TweenBuilderConfig).angle = 90;
    scene.tweens.add(tween);
    views.delete(view.entityId);
    if (view.operatorId) opIds.delete(view.operatorId);
  }

  // ------------------------------------------------------------
  // 事件订阅（bus.on 返回取消函数，全部收进 unsubs）
  // ------------------------------------------------------------

  const on = state.bus.on.bind(state.bus);

  unsubs.push(on("enemySpawned", e => { makeEnemyView(e.entityId); }));
  unsubs.push(on("operatorDeployed", e => {
    const view = makeOperatorView(e.entityId, e.operatorId);
    // 落地动效：0 → 1 缩放（0.15s）
    view.container.setScale(0);
    scene.tweens.add({ targets: view.container, scale: 1, duration: 150, ease: "Back.Out" });
  }));
  unsubs.push(on("operatorRetreated", e => {
    const eid = opIds.get(e.operatorId);
    if (eid !== undefined) {
      const view = views.get(eid);
      if (view) fadeOut(view, false);
    }
  }));
  unsubs.push(on("entityDied", e => {
    const view = views.get(e.entityId);
    if (view) fadeOut(view, true); // 0.3s 旋转 90° + 淡出
  }));
  unsubs.push(on("attackLanded", e => {
    const view = views.get(e.target);
    if (!view) return;
    // 受击闪白：alpha 脉冲（0.1s 往返）
    scene.tweens.add({ targets: view.container, alpha: 0.25, duration: 50, yoyo: true });
  }));
  unsubs.push(on("enemyLeaked", () => {
    // 漏怪警示：防御点红色脉冲圆环（位置取 stage.goals[0]，敌人实体已销毁）
    const goal = state.stage.goals[0];
    const p = cellToPx(goal.row, goal.col);
    const ring = scene.add.circle(p.x, p.y - CELL / 2, 10).setStrokeStyle(3, 0xe24b4a, 1);
    scene.tweens.add({
      targets: ring, radius: 44, alpha: 0, duration: 450, ease: "Cubic.Out",
      onComplete: () => ring.destroy()
    });
  }));

  // ------------------------------------------------------------
  // 每帧同步
  // ------------------------------------------------------------

  function update(dt: number): void {
    const k = Math.min(1, dt * 12); // 平滑跟随系数

    // 1) 存活实体：位置平滑跟随 + 血条 + 被阻挡角标
    for (const eid of state.world.query("identity", "position")) {
      const view = ensureView(eid);
      if (!view) continue;
      const pos = state.world.get(eid, "position")!;
      const target = cellToPx(pos.row, pos.col);
      view.container.x += (target.x - view.container.x) * k;
      view.container.y += (target.y - view.container.y) * k;

      const health = state.world.get(eid, "health");
      if (health) view.barFg.scaleX = Math.max(0, Math.min(1, health.hp / health.maxHp));

      // 敌人：阻挡角标显隐
      if (view.faction === "enemy") {
        const path = state.world.get(eid, "enemyPath");
        view.badge?.setVisible((path?.blockedBy ?? -1) !== -1);
      }
    }

    // 2) 阻挡连线：按 enemyPath.blockedBy 每帧对账（事件创建的连线，
    //    两端任一死亡/解除即在此移除——比纯事件驱动更稳）
    const blockedNow = new Set<number>();
    for (const eid of state.world.query("enemyPath")) {
      const path = state.world.get(eid, "enemyPath")!;
      if (path.blockedBy === -1 || !state.world.alive(path.blockedBy)) continue;
      blockedNow.add(eid);
      let line = lines.get(eid);
      if (!line) {
        line = { gfx: scene.add.graphics(), enemyId: eid, blockerId: path.blockedBy };
        lines.set(eid, line);
      }
      // 重画虚线（两端位置每帧更新）
      const a = cellToPx(state.world.get(eid, "position")!.row, state.world.get(eid, "position")!.col);
      const bp = state.world.get(path.blockedBy, "position");
      if (!bp) continue;
      const b = cellToPx(bp.row, bp.col);
      drawDashed(line.gfx, a.x, a.y - 20, b.x, b.y - 20);
    }
    // 移除已失效连线
    for (const [eid, line] of lines) {
      if (!blockedNow.has(eid)) {
        line.gfx.destroy();
        lines.delete(eid);
      }
    }
  }

  /** 两点间 3px 虚线（线段长 6、间隔 6） */
  function drawDashed(gfx: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
    gfx.clear();
    gfx.lineStyle(3, BLOCK_LINE_COLOR, 0.9);
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.max(1, Math.floor(dist / 12));
    for (let i = 0; i < steps; i += 2) {
      const t1 = i / steps, t2 = Math.min(1, (i + 1) / steps);
      gfx.lineBetween(
        x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1,
        x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2
      );
    }
  }

  // 场景关闭时自动销毁（防泄漏）
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroy());

  function destroy(): void {
    for (const fn of unsubs) fn();
    unsubs.length = 0;
    for (const v of views.values()) v.container.destroy();
    views.clear();
    for (const l of lines.values()) l.gfx.destroy();
    lines.clear();
  }

  // 断线重连场景：对 world 里已存在的实体补建表现
  for (const eid of state.world.query("identity")) ensureView(eid);

  return { update, destroy };
}
