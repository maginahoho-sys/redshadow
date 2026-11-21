/**
 * M16 boot-scene —— 标题画面（BootScene）
 *
 * 职责：游戏入口 → 「新的探索」/「继续探索」（有存档时）。
 * 路由：Boot → Rogue（新局不带 run → 分队选择；续局带 run → 直接节点图）。
 * 视觉：暗色幕布 + 血月 + 剧团标题，保持红黑主题调性。
 */
import Phaser from "phaser";
import { loadRun, clearRun } from "../meta/save";

const FONT = "sans-serif";
const OK_NUM = 0x6fc06f;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#14121a");

    // 背景血月 + 幕布装饰
    this.add.circle(640, 250, 130, 0x8a2430, 1)
      .setStrokeStyle(4, 0xb03a3a);
    this.add.circle(600, 220, 12, 0x6a1a24);  // 月面阴影坑
    this.add.circle(680, 290, 8, 0x6a1a24);
    this.add.rectangle(640, 720, 1280, 120, 0x0c0a10); // 底部暗幕

    // 标题
    this.add.text(640, 250, "猩红孤钻", {
      fontFamily: FONT, fontSize: "72px", color: "#e8c34a",
      stroke: "#5a1018", strokeThickness: 8
    }).setOrigin(0.5);
    this.add.text(640, 330, "— 集成战略 · 血月剧团巡演 —", {
      fontFamily: FONT, fontSize: "20px", color: "#8f8a80"
    }).setOrigin(0.5);

    // 按钮
    const hasSave = loadRun() !== null;
    if (hasSave) {
      this.mkButton(640, 470, "继续探索", () => {
        const run = loadRun();          // 再读一次防竞态（点击瞬间清档）
        if (run) this.scene.start("Rogue", { run });
      });
      this.mkButton(640, 540, "新的探索", () => this.confirmOverwrite());
    } else {
      this.mkButton(640, 500, "新的探索", () => this.scene.start("Rogue", {}));
    }

    this.add.text(640, 640, "Phaser3 · 自研 ECS · 数据驱动内容包", {
      fontFamily: FONT, fontSize: "12px", color: "#55505c"
    }).setOrigin(0.5);
  }

  /** 通用按钮 */
  private mkButton(x: number, y: number, label: string, cb: () => void): void {
    const rect = this.add.rectangle(x, y, 260, 48, 0x3d3245)
      .setStrokeStyle(1, OK_NUM)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => rect.setFillStyle(0x52405a))
      .on("pointerout", () => rect.setFillStyle(0x3d3245))
      .on("pointerdown", cb);
    this.add.text(x, y, label, {
      fontFamily: FONT, fontSize: "20px", color: "#e8e2d9"
    }).setOrigin(0.5);
  }

  /** 有存档时点「新的探索」→ 覆盖确认 */
  private confirmOverwrite(): void {
    const c = this.add.container(0, 0);
    c.add(this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.72).setInteractive());
    c.add(this.add.rectangle(640, 360, 560, 240, 0x211d29).setStrokeStyle(2, 0x5a5364));
    c.add(this.add.text(640, 300, "已存在探索存档", {
      fontFamily: FONT, fontSize: "22px", color: "#d85a30"
    }).setOrigin(0.5));
    c.add(this.add.text(640, 350, "开始新的探索将覆盖当前存档，是否继续？", {
      fontFamily: FONT, fontSize: "15px", color: "#e8e2d9"
    }).setOrigin(0.5));

    const yes = this.add.rectangle(520, 430, 130, 40, 0x4a2028)
      .setStrokeStyle(1, 0xd04a4a).setInteractive({ useHandCursor: true });
    const no = this.add.rectangle(760, 430, 130, 40, 0x3d3245)
      .setStrokeStyle(1, OK_NUM).setInteractive({ useHandCursor: true });
    c.add([yes, no]);
    c.add(this.add.text(520, 430, "覆盖并开始", {
      fontFamily: FONT, fontSize: "15px", color: "#e8e2d9"
    }).setOrigin(0.5));
    c.add(this.add.text(760, 430, "返回", {
      fontFamily: FONT, fontSize: "15px", color: "#e8e2d9"
    }).setOrigin(0.5));

    yes.on("pointerdown", () => {
      clearRun();
      this.scene.start("Rogue", {});
    });
    no.on("pointerdown", () => c.destroy());
  }
}
