/**
 * M11 rogue-ui —— 肉鸽探索界面（RogueScene）
 * 流程：分队选择 → 节点图推进（战斗节点进 BattleScene，其余弹面板）→ 跨层 → 结局。
 * 战斗交接：进战斗前组装 M4 词条求值产物 + createBattle；
 * BattleScene HUD 在其 scene.events 上 emit "battle-finished"，本场景 events.once 接住。
 */
import Phaser from "phaser";
import type { RunState, NodeType, OperatorDef, EnemyDef, RelicDef, RelicMod, EventDef, ShopItem, TeamDef } from "../contracts";
import { createRng, type Rng } from "../contracts";
import runConfig from "../data/run-config.json";
import operatorsJson from "../data/operators.json";
import enemiesJson from "../data/enemies.json";
import relicsJson from "../data/relics.json";
import eventsJson from "../data/events.json";
import { createRun, nodeRewards, pickStage, advanceFloor, RUN_WIN_MARK } from "../meta/run-bootstrap";
import { recruitCost, recruitOperator, promoteOperator, generateShopItems, resolveEvent } from "../meta/run-ops";
import { buildOperatorEffective, buildEnemyDefs, buildGlobals } from "../systems/relics";
import { createBattle } from "../game/battle-glue";
import { saveRun, clearRun } from "../meta/save";
// ---- 数据与常量 ----

const OPERATOR_DEFS: Record<string, OperatorDef> = Object.fromEntries(
  (operatorsJson as unknown as OperatorDef[]).map(o => [o.id, o])
);
const OPERATOR_LIST = Object.values(OPERATOR_DEFS);
const ENEMY_LIST = enemiesJson as unknown as EnemyDef[];
const RELIC_LIST = relicsJson as unknown as RelicDef[];
const RELIC_IDS = RELIC_LIST.map(r => r.id);
const EVENT_LIST = eventsJson as unknown as EventDef[];
const CFG = runConfig as unknown as {
  runStart: { hopeCap: number; objectiveHpCap: number; squadSizeBase: number };
  recruitCostByRarity: Record<string, number>;
  promoteCostByRarity: Record<string, number>;
  teams: TeamDef[];
};

/** 节点类型 → 圆的颜色 / 中文标签（SPEC 指定色值） */
const NODE_COLOR: Record<NodeType, number> = {
  battle: 0xc98a4a, emergencyBattle: 0xd04a4a, shop: 0x6fa8e0,
  event: 0xb26fe0, gift: 0x6fc06f, safeCorner: 0x64d9c8,
  interlude: 0xd8b13c, boss: 0xe24b4a
};
const NODE_LABEL: Record<NodeType, string> = {
  battle: "作战", emergencyBattle: "紧急", shop: "行商",
  event: "偶遇", gift: "馈赠", safeCorner: "安全",
  interlude: "余兴", boss: "首领"
};
const OK_NUM = 0x6fc06f;
const FONT = "sans-serif";
/** scene.start("Rogue", data) 的数据形状 */
type RunData = { run?: RunState; result?: "won" | "lost"; rewards?: string };
// ---- RogueScene ----

export class RogueScene extends Phaser.Scene {
  private run!: RunState;
  private rng!: Rng;
  /** 当前进入中的节点（完成时写 visited/current） */
  private pendingNodeId: string | null = null;

  constructor() {
    super("Rogue");
  }

  create(): void {
    const data = this.scene.settings.data as RunData | undefined;
    this.cameras.main.setBackgroundColor("#14121a");

    if (!data?.run) { this.showTeamSelect(); return; }
    this.run = data.run;
    this.rng = createRng(this.run.seed + this.run.eventLog.length);
    saveRun(this.run);   // M16 存档点：战斗归来 / 面板结算后的最新快照落盘

    // 探索终局判定
    if (this.run.objectiveHp <= 0) { this.showEnding(false); return; }
    if (this.run.eventLog.includes(RUN_WIN_MARK)) { this.showEnding(true); return; }

    // 战斗归来：先弹奖励面板（确认后回节点图）；失败则直接回图
    if (data.result === "won" && data.rewards) {
      this.completePendingNode();
      this.showRewardPanel(data.rewards);
      return;
    }
    if (data.result === "lost") this.completePendingNode();
    this.showMap();
  }

  /** 战斗归来：把进入中的节点标记为已完成 */
  private completePendingNode(): void {
    if (!this.pendingNodeId) return;
    const node = this.run.nodeMap.nodes[this.pendingNodeId];
    if (!this.run.visitedNodeIds.includes(node.id)) this.run.visitedNodeIds.push(node.id);
    this.run.currentNodeId = node.id;
    this.pendingNodeId = null;
    saveRun(this.run);   // M16 存档点：节点完成后落盘
  }  /** 统一文本（默认字体/颜色，省行数） */
  private txt(x: number, y: number, s: string, size: number, color = "#e8e2d9",
              wrap = 0, center = false): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, {
      fontFamily: FONT, fontSize: `${size}px`, color,
      wordWrap: wrap > 0 ? { width: wrap } : undefined, align: center ? "center" : "left"
    }).setOrigin(center ? 0.5 : 0);
  }
  // ---- 1. 分队选择 ----

  private showTeamSelect(): void {
    this.txt(640, 90, "猩红孤钻 · 选择你的分队", 30, "#d85a30", 0, true);
    const teams = CFG.teams;
    const cardW = 250;
    const startX = 640 - (teams.length * (cardW + 20) - 20) / 2;
    teams.forEach((team, i) => {
      const x = startX + i * (cardW + 20);
      const cx = x + cardW / 2;
      this.add.rectangle(cx, 340, cardW, 220, 0x2a2530).setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          const seed = Date.now() % 1_000_000_000; // 局种子（调试可复现：手动改 seed）
          this.scene.start("Rogue", { run: createRun(seed, team.id) } satisfies RunData);
        });
      this.txt(cx, 280, team.name, 20, "#d85a30", 0, true);
      this.txt(cx, 350, team.description, 13, undefined, cardW - 24, true);
    });
    this.txt(640, 600, "分队词条将作用于整局探索（属性 / 全局 / 初始资源）", 13, "#8f8a80", 0, true);
  }
  // ---- 2. 节点图 ----
  /** 节点渲染坐标：col 0/0.5/1 → x 400/640/880；row → y 递增 90 */
  private nodePos(row: number, col: number): { x: number; y: number } {
    return { x: 400 + col * 480, y: 130 + row * 90 };
  }

  private showMap(): void {
    this.drawTopBar();
    const map = this.run.nodeMap;
    this.txt(640, 60, `第 ${this.run.floor} 层 · ${map.floorName}`, 22, undefined, 0, true);

    // 可进入节点：当前节点的 next；currentNodeId 为 null 时是 start
    const enterable = this.run.currentNodeId === null
      ? [map.start] : map.nodes[this.run.currentNodeId].next;

    // next 连线（两端都访问过的边提亮）
    for (const node of Object.values(map.nodes)) {
      for (const nx of node.next) {
        const a = this.nodePos(node.row, node.col);
        const b = this.nodePos(map.nodes[nx].row, map.nodes[nx].col);
        const done = this.run.visitedNodeIds.includes(node.id) && this.run.visitedNodeIds.includes(nx);
        this.add.line(0, 0, a.x, a.y, b.x, b.y, done ? 0x6a6458 : 0x4a4650).setOrigin(0);
      }
    }

    // 节点圆 + 标签 + 勾 + 可进入脉冲
    for (const node of Object.values(map.nodes)) {
      const { x, y } = this.nodePos(node.row, node.col);
      const visited = this.run.visitedNodeIds.includes(node.id);
      const r = node.type === "boss" ? 33 : 22;
      const circle = this.add.circle(x, y, r, NODE_COLOR[node.type]).setAlpha(visited ? 0.45 : 1);
      this.txt(x, y, NODE_LABEL[node.type], node.type === "boss" ? 15 : 13, "#1a171f", 0, true);
      if (visited) this.add.text(x + 16, y - 18, "✓", { fontSize: "16px", color: "#6fc06f" });

      if (enterable.includes(node.id)) {
        const ring = this.add.circle(x, y, r + 6).setStrokeStyle(3, OK_NUM);
        this.tweens.add({ targets: ring, alpha: { from: 1, to: 0.25 }, duration: 700, yoyo: true, repeat: -1 });
        circle.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.enterNode(node.id));
      }
    }
    this.txt(640, 690, "点击描边脉冲的节点进入 · 战斗节点进入战斗场景", 12, "#8f8a80", 0, true);
  }

  /** 进入节点：按类型分流（id 不存在直接忽略） */
  private enterNode(nodeId: string): void {
    const node = this.run.nodeMap.nodes[nodeId];
    if (!node) return;
    this.pendingNodeId = nodeId;
    const type = node.type;
    switch (type) {
      case "battle": case "emergencyBattle": case "boss":
        this.startBattle(type); break;
      case "shop": this.openShop(); break;
      case "event": this.openEvent(); break;
      case "gift":
        this.openSimplePanel("古堡馈赠", "墙缝里的暗格中放着一件宝物。", () => {
          const id = this.rng.pick(RELIC_IDS);
          this.run.relics.push(id);
          return `获得收藏品【${RELIC_LIST.find(r => r.id === id)?.name ?? id}】`;
        });
        break;
      case "safeCorner":
        this.openSimplePanel("安全角落", "暂时没有敌人追踪。原地休整，恢复 1 点目标生命。", () => {
          this.run.objectiveHp = Math.min(this.run.objectiveHpCap, this.run.objectiveHp + 1);
          return `目标生命恢复至 ${this.run.objectiveHp}`;
        });
        break;
      case "interlude":
        this.openSimplePanel("幕间余兴", "剧团的杂耍演员送来一张职业招募券。", () => {
          const professions = [...new Set(OPERATOR_LIST.map(o => o.profession))];
          const p = this.rng.pick(professions);
          this.run.recruitTickets.push(p);
          return `获得【${p}】职业招募券`;
        });
        break;
    }
  }
  // ---- 3. 战斗交接 ----
  /** 组装词条求值产物并进入战斗场景 */
  private startBattle(nodeType: NodeType): void {
    const state = this.run;
    // 兜底：编队为空时先免费补 3 名基础干员（探索层招募还没机会发生）
    if (state.squad.length === 0) {
      for (const op of OPERATOR_LIST.slice(0, 3)) {
        state.squad.push(op.id);
        state.eventLog.push(`初始补员 ${op.id}`);
      }
    }
    const team = CFG.teams.find(t => t.id === state.teamId) ?? CFG.teams[0];
    // 词条 = 分队 mods + 已获收藏品 mods
    const mods: RelicMod[] = [...(team.mods as RelicMod[])];
    for (const rid of state.relics) {
      const relic = RELIC_LIST.find(r => r.id === rid);
      if (relic) mods.push(...(relic.mods as RelicMod[]));
    }
    const stage = pickStage(this.rng, nodeType, state.floor);
    const battle = createBattle({
      stage,
      squadOperatorIds: [...state.squad],
      operatorDefs: OPERATOR_DEFS,
      enemyDefs: buildEnemyDefs(ENEMY_LIST, mods),
      effective: buildOperatorEffective(OPERATOR_LIST, mods),
      globals: buildGlobals({
        dpRate: stage.dpRate, initialDp: stage.initialDp,
        objectiveHp: state.objectiveHp,        // 探索生命带入战斗
        tempObjectiveHp: 0, squadSize: CFG.runStart.squadSizeBase
      }, mods),
      seed: state.seed + state.floor * 1000 + state.eventLog.length
    });

    // 接战斗结果：HUD 在 Battle 场景 events 上 emit "battle-finished"。
    // 注意：回调发生时 Rogue 已 shutdown，必须用活动中的 Battle 场景插件切场景。
    const battleScene = this.scene.get("Battle");
    battleScene.events.once("battle-finished", (result: "won" | "lost") => {
      // 同步战斗内的目标生命（胜利前也可能漏怪）
      state.objectiveHp = Math.max(0, battle.objectiveHp);
      // 就地标记节点完成（此刻旧层节点图仍有效；boss 过层会换图，标记无意义）
      if (this.pendingNodeId && nodeType !== "boss") {
        const nid = this.pendingNodeId;
        if (!state.visitedNodeIds.includes(nid)) state.visitedNodeIds.push(nid);
        state.currentNodeId = nid;
      }
      this.pendingNodeId = null;
      if (result === "won") {
        const r = nodeRewards(state, nodeType, this.rng, RELIC_IDS);
        if (nodeType === "boss") advanceFloor(state, this.rng);
        battleScene.scene.start("Rogue", {
          run: state, result,
          rewards: `+${r.hope} 希望　+${r.ingots} 源石锭${r.relicId
            ? `　获得收藏品【${RELIC_LIST.find(x => x.id === r.relicId)?.name ?? r.relicId}】` : ""}${r.ticket
            ? `　获得【${r.ticket}】职业招募券` : ""}`
        } satisfies RunData);
        return;
      }
      state.eventLog.push(`战斗失败：${stage.name}`);
      battleScene.scene.start("Rogue", { run: state, result } satisfies RunData);
    });
    this.scene.start("Battle", { battle });
  }
  // ---- 4. 面板框架 ----
  /** 通用面板：全屏遮罩 + 标题/副标题，返回面板容器（内容往上加） */
  private panel(title: string, subtitle?: string): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    c.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.72).setInteractive()); // 挡穿透
    c.add(this.add.rectangle(640, 360, 760, 500, 0x211d29).setStrokeStyle(2, 0x5a5364));
    const t1 = this.txt(640, 160, title, 24, "#d85a30", 0, true);
    const t2 = subtitle ? this.txt(640, 200, subtitle, 14, undefined, 700, true) : null;
    c.add(t1);
    if (t2) c.add(t2);
    return c;
  }

  /** 面板内按钮（禁用置灰） */
  private button(c: Phaser.GameObjects.Container, x: number, y: number,
                 label: string, cb: () => void, disabled = false): void {
    const w = Math.max(120, label.length * 15 + 32);
    const rect = this.add.rectangle(x, y, w, 40, disabled ? 0x35313c : 0x3d3245)
      .setStrokeStyle(1, disabled ? 0x55505c : OK_NUM)
      .setInteractive({ useHandCursor: !disabled });
    c.add(rect);
    c.add(this.add.text(x, y, label, {
      fontFamily: FONT, fontSize: "14px", color: disabled ? "#8f8a80" : "#e8e2d9", align: "center"
    }).setOrigin(0.5));
    if (!disabled) rect.on("pointerdown", cb);
  }

  /** 简单结算面板（馈赠/安全角落/余兴）：立即结算 → 展示获得物 → 关闭完成节点 */
  private openSimplePanel(title: string, desc: string, apply: () => string): void {
    const c = this.panel(title, `${desc}\n\n${apply()}`);
    this.button(c, 640, 540, "继续", () => this.finishPanel());
  }

  /** 关闭任意面板 = 完成该节点 */
  private finishPanel(): void {
    this.completePendingNode();
    this.children.removeAll();
    this.showMap();
  }
  // ---- 5. 商店 ----
  private openShop(): void {
    const pools = {
      relicIds: RELIC_IDS,
      professions: [...new Set(OPERATOR_LIST.map(o => o.profession))],
      operatorIds: OPERATOR_LIST.map(o => o.id)
    };
    this.renderShop(generateShopItems(this.rng, this.run.floor, pools)
      .map(it => ({ ...it, sold: false })));
  }

  private renderShop(items: ShopItem[]): void {
    const c = this.panel("诡意行商", `源石锭 ${this.run.ingots} · 关闭面板即离开`);
    items.forEach((item, i) => {
      const x = 640 + (i - 1.5) * 180;
      const y = 320;
      c.add(this.add.rectangle(x, y, 160, 150, 0x2a2530).setStrokeStyle(1, 0x4a4650));
      c.add(this.txt(x, y - 45, this.shopLabel(item), 13, undefined, 140, true));
      c.add(this.txt(x, y + 30, `${item.cost} 锭`, 16, "#6fc06f", 0, true));
      if (!item.sold) {
        this.button(c, x, y + 62, "购买", () => {
          this.buyShopItem(items, i);
          this.children.removeAll();
          this.renderShop(items);
        }, this.run.ingots < item.cost);
      } else {
        c.add(this.txt(x, y + 62, "已售", 13, "#8f8a80", 0, true));
      }
    });
    this.button(c, 640, 560, "离开商店", () => this.finishPanel());
  }

  /** 商品显示名 */
  private shopLabel(item: ShopItem): string {
    switch (item.kind) {
      case "relic": return `收藏品\n${RELIC_LIST.find(x => x.id === item.payloadId)?.name ?? item.payloadId}`;
      case "ticket": return item.payloadId === "high" ? "高级招募券" : `招募券·${item.payloadId}`;
      case "promotion": return `进阶·${OPERATOR_DEFS[item.payloadId]?.name ?? item.payloadId}`;
      case "life": return "目标生命 +1";
      case "operator": return `干员\n${OPERATOR_DEFS[item.payloadId]?.name ?? item.payloadId}`;
    }
  }

  /** 购买：扣款 + 按种类入账 */
  private buyShopItem(items: ShopItem[], index: number): void {
    const item = items[index];
    if (item.sold || this.run.ingots < item.cost) return;
    this.run.ingots -= item.cost;
    (item as { sold?: boolean }).sold = true;
    const squadLimit = CFG.runStart.squadSizeBase;
    switch (item.kind) {
      case "relic": this.run.relics.push(item.payloadId); break;
      case "ticket": this.run.recruitTickets.push(item.payloadId); break;
      case "life":
        this.run.objectiveHp = Math.min(this.run.objectiveHpCap, this.run.objectiveHp + 1);
        break;
      case "operator":
        // 商店购买即招募（源石锭已在价格里扣过）：入队/满编入后备
        if (this.run.squad.length < squadLimit) this.run.squad.push(item.payloadId);
        else this.run.reserve.push(item.payloadId);
        break;
      case "promotion": {
        // 优先对该干员进阶；未持有则对第一个未进阶的持有者进阶
        const held = this.run.squad.concat(this.run.reserve);
        const target = held.includes(item.payloadId) ? item.payloadId
          : held.find(id => !this.run.promoted[id]);
        if (target && !this.run.promoted[target]) {
          promoteOperator(this.run, target, CFG.promoteCostByRarity);
        }
        break;
      }
    }
    this.run.eventLog.push(`商店购买 ${item.kind}:${item.payloadId}（${item.cost} 锭）`);
  }
  // ---- 6. 事件 / 招募 ----
  private openEvent(): void {
    // 抽一个未遇到过的事件（eventLog 里已含其 id 视为遇到过）
    const unseen = EVENT_LIST.filter(ev => !this.run.eventLog.some(l => l.includes(ev.id)));
    this.renderEvent(unseen.length > 0 ? this.rng.pick(unseen) : this.rng.pick(EVENT_LIST), null);
  }

  private renderEvent(ev: EventDef, resultText: string | null): void {
    const c = this.panel(ev.title, ev.text);
    if (resultText !== null) {
      c.add(this.txt(640, 380, resultText, 16, "#6fc06f", 680, true));
      this.button(c, 640, 540, "关闭", () => this.finishPanel());
      return;
    }
    ev.options.forEach((opt, i) => {
      const disabled =
        (opt.requireHope !== undefined && this.run.hope < opt.requireHope) ||
        (opt.requireIngots !== undefined && this.run.ingots < opt.requireIngots) ||
        (opt.requireHp !== undefined && this.run.objectiveHp < opt.requireHp);
      this.button(c, 640, 300 + i * 70,
        disabled ? `${opt.text}（条件不足）` : opt.text, () => {
          const applied = resolveEvent(this.run, ev, i, this.rng, RELIC_IDS, CFG.runStart.squadSizeBase);
          const text = applied === null ? "条件不满足。"
            : applied.length === 0 ? "你转身离开，什么也没发生。"
            : `获得效果：${applied.map(e => this.effectText(e)).join("、")}`;
          this.children.removeAll();
          this.renderEvent(ev, text);
        }, disabled);
    });
  }

  /** 效果 → 中文短句 */
  private effectText(e: { kind: string; op: string; value?: number | string }): string {
    if (e.op === "remove") return `失去 ${e.value}`;
    const sign = (v: number) => (v > 0 ? "+" : "") + v;
    switch (e.kind) {
      case "hope": return `${sign(e.value as number)} 希望`;
      case "ingots": return `${sign(e.value as number)} 源石锭`;
      case "hp": return `${sign(e.value as number)} 目标生命`;
      case "relic": {
        const id = e.value === "random" ? "随机收藏品"
          : RELIC_LIST.find(r => r.id === e.value)?.name ?? e.value;
        return `收藏品【${id}】`;
      }
      case "ticket": return `招募券·${e.value}`;
      case "operator": return `干员 ${OPERATOR_DEFS[e.value as string]?.name ?? e.value}`;
      default: return String(e.value);
    }
  }
  // ---- 7. 顶部条 / 招募 / 奖励 / 结局 ----
  private drawTopBar(): void {
    this.txt(40, 24, `生命 ${"■".repeat(Math.max(0, this.run.objectiveHp))}`, 16);
    this.txt(40, 50, `希望 ${this.run.hope}/${this.run.hopeCap}`, 14);
    this.txt(200, 50, `源石锭 ${this.run.ingots}`, 14);
    this.txt(380, 50, `干员 ${this.run.squad.length}+${this.run.reserve.length}　收藏品 ${this.run.relics.length}`, 14);
    if (this.run.recruitTickets.length > 0) {
      this.add.rectangle(1150, 40, 130, 34, 0x3d3245).setStrokeStyle(1, OK_NUM)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => { this.children.removeAll(); this.openRecruit(); });
      this.txt(1150, 40, `招募 (${this.run.recruitTickets.length})`, 14, undefined, 0, true);
    }
  }
  /** 招募面板：每张券 3 名候选（按券类型过滤后 rng 取 3），点选招募消耗该券 */
  private openRecruit(): void {
    const state = this.run;
    const c = this.panel("剧团招募", `希望 ${state.hope}/${state.hopeCap}`);
    let y = 280;
    state.recruitTickets.forEach((ticket, ti) => {
      const key = `${ti}:${ticket}`;
      // 候选：职业券按职业过滤；高级券取稀有度 ≥5；候选不足则回退全量
      let pool = OPERATOR_LIST.filter(o =>
        ticket === "high" ? o.rarity >= 5 : o.profession === ticket);
      if (pool.length === 0) pool = OPERATOR_LIST;
      const candidates = state.recruitPools[key] ?? (() => {
        const picks: string[] = [];
        const bag = [...pool];
        while (picks.length < Math.min(3, bag.length)) {
          picks.push(bag.splice(this.rng.int(0, bag.length - 1), 1)[0].id);
        }
        state.recruitPools[key] = picks;
        return picks;
      })();

      c.add(this.txt(320, y - 24, `【${ticket === "high" ? "高级" : ticket}招募券】`, 14, "#d85a30"));
      candidates.forEach((opId, ci) => {
        const def = OPERATOR_DEFS[opId];
        const cost = recruitCost(def.rarity, CFG.recruitCostByRarity);
        this.button(c, 400 + ci * 180, y, `${def.name} ★${def.rarity} ${cost}希望`, () => {
          if (recruitOperator(state, opId, CFG.recruitCostByRarity, CFG.runStart.squadSizeBase, OPERATOR_DEFS)) {
            state.recruitTickets.splice(ti, 1); // 消耗一张券
            delete state.recruitPools[key];
          }
          this.children.removeAll();
          if (state.recruitTickets.length > 0) this.openRecruit(); else this.finishPanel();
        }, state.hope < cost);
      });
      y += 90;
    });
    this.button(c, 640, 560, "关闭", () => this.finishPanel());
  }

  /** 战斗奖励面板 */
  private showRewardPanel(text: string): void {
    const c = this.panel("作战结算", text);
    this.button(c, 640, 500, "确认", () => {
      this.children.removeAll();
      this.showMap();
    });
  }

  /** 探索终局：胜利 / 失败（局终清档，回到标题） */
  private showEnding(won: boolean): void {
    clearRun();   // M16 存档点：探索结束即清档
    const opCount = this.run.squad.length + this.run.reserve.length;
    this.txt(640, 240, won ? "探索胜利" : "探索失败", 44, won ? "#e8c34a" : "#d04a4a", 0, true);
    this.txt(640, 330,
      `到达第 ${this.run.floor} 层 · 干员 ${opCount} · 收藏品 ${this.run.relics.length} · 事件 ${this.run.eventLog.length} 条`,
      18, undefined, 0, true);
    this.add.rectangle(640, 460, 200, 48, 0x3d3245).setStrokeStyle(1, OK_NUM)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.scene.start("Boot"));
    this.txt(640, 460, "再来一局", 18, undefined, 0, true);
  }
}
