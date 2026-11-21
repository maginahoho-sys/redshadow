# RedShadow 项目长期记忆

## 项目定位
明日方舟「集成战略：傀影与猩红孤钻」玩法复刻（原创素材/命名），Phaser3+TS+自研 ECS，
目标是「大模型定合同、小模型（混元4flash）逐模块实现」的省积分开发模式。

## 冻结约定（P0 定案，改动需用户批准）
- `src/contracts/`、`tests/helpers.ts`：只许 import 不许修改；扩展只加可选字段。
- 逻辑层（systems/meta）禁止 import Phaser；随机只用注入 Rng，禁 Math.random。
- 单模块 ≤500 行（M11 允许 bootstrap+ui 两文件）；中文注释。
- 验收测试即合同：交付必须让 tests/mX.test.ts 全绿，禁止改测试。
- pending 测试移入 tests/ 时：`../../src/`→`../src/`、`../helpers`→`./helpers`。

## 关键事实
- 战斗公式：物理 max(atk-def, atk*5%)；法术 max(atk*(1-res/100), atk*5%)，res 夹紧 0-100。
- 移动规则：先纵向后横向；大步长逐路点推进；越过末路点=漏怪。
- 词条结算：同属性先汇总 add 再连乘 mul；敌人词条产克隆不改原定义。
- 系统帧顺序（stepBattle）：wave → movement → assignBlocking → combat → deployment → checkBattleEnd。
- 沙箱命令一律带 `env -u NODE_OPTIONS`；sed 异常时用 perl -pi。

## 状态
- 2026-11-20 P0 完成（commit 2460db9）：骨架+合同层+示例数据+M1-M7 验收用例+16 SPEC。
- 2026-11-21 M1 战斗结算完成（commit f23f472）：src/systems/combat.ts，验收 10/10 全绿。
  关键语义：干员优先攻击被自己阻挡的敌人且不受射程限制；死亡清理统一在攻击结算后。
- 待办：M2 敌人寻路（specs/m2-敌人寻路.md）；里程碑 A（单关可玩）= M2/M3/M5/M8/M9/M10。
