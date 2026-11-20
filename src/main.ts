import Phaser from "phaser";

/**
 * P0 占位启动场景：合同层就绪后的最小可运行入口。
 * M8/M9 交付后由真正的战斗场景替换，M16 做最终串联。
 */
class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x14121a);

    this.add.text(width / 2, height / 2 - 20, "RedShadow", {
      fontFamily: "sans-serif",
      fontSize: "32px",
      color: "#e8e2d9"
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 + 24,
      "P0 合同层就绪 · 按 M1 → M16 顺序交付模块", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#9c93b8"
    }).setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14121a",
  scene: [BootScene]
});
