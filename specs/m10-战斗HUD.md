# SPEC M10 —— 战斗 HUD 与部署交互

## 目标

战斗界面的全部 UI：费用条、目标生命、波次进度、干员部署栏（点选卡片→点格子部署）、
撤退交互、倍速/暂停、结算面板。

**前置**：M3、M8 已交付。

## 交付物

- 文件：`src/render/battle-hud.ts`（单文件，≤ 400 行，中文注释）

## 允许 import（白名单）

```ts
import Phaser from "phaser";
import { ... } from "../contracts";
import { canDeploy, deployOperator, retreatOperator } from "../systems/deployment";
import { CELL } from "./grid-scene";
```

## 必须导出的 API

```ts
export function createBattleHud(scene: Phaser.Scene, state: BattleState): void;
```

## 行为规则

### 顶部状态条（y ≤ 100）

- 关卡名（左）；目标生命：画小方块串，剩余亮红、已损失暗灰（中）；
- 波次：`waveIndex / stage.waves.length`（右上，扣去未开始的）；
- 费用：左下角大号数字 `Math.floor(dp)` + 副文本 `有效回复速率`（从 globals 计算展示）。

### 部署栏（底部，y = 660 起）

- 每名 SquadMember 一张卡片（宽 120 高 90）：职业色边框（同 M9 色表）、
  名字、费用数字；ready=正常，cooldown=灰蒙 + 倒计时数字，deployed=高亮描边。
- **点选卡片** → 进入部署模式：
  - 遍历场上格子调 `canDeploy`，合法格描边绿色、非法格描边暗红半透明；
  - **点合法格** → `deployOperator`（失败则 toast 文字提示原因 1.5s）；
  - 点空白处或再点卡片取消部署模式。
- **点击已部署干员** → 弹出小面板："撤退（返还全部费用）" 按钮 → `retreatOperator`。
- 每帧刷新卡片状态与费用数字。

### 控制（右上角按钮）

- ⏸/▶ 暂停：写 `scene.registry.set("battlePaused", !current)`；
- ×1/×2 倍速：写 `scene.registry.set("battleSpeed", 1 | 2)`。

### 结算面板（订阅 battleEnded）

- 全屏半透明遮罩 + 大字："作战胜利"（#e8c35a）或"作战失败"（#d04a4a）；
- 显示本关耗时与波次数；提示"返回节点地图"（M11 接管前的占位按钮，
  点击 `scene.events.emit("battle-finished", result)`）。

## 验收（手动）

1. 点卡片→格子亮绿→点击部署扣费；费用不足卡片变灰；
2. 撤退后卡片倒计时，归零可再部署；先锋部署后费用增速可见加快；
3. ×2 生效、暂停生效；漏怪目标生命亮块减少；
4. 全灭敌人后出现"作战胜利"面板。
5. `env -u NODE_OPTIONS npx tsc --noEmit` 无报错。

## 禁止事项

- 不许 import 白名单外模块；不许写死地形/数值判断（合法性一律调 canDeploy）；
- 不许改 contracts / tests / 其他已交付文件。
