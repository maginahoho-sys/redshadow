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
- 2026-11-21 M2 敌人寻路完成（commit 1bdd558）：src/systems/movement.ts，验收 6/6 全绿。
  关键语义：移动前按段方向投影把 index 快进越过已通过路点（测试敌人可出生在末段）。
- 2026-11-21 M3 部署费用完成（commit bb4bfcc）：src/systems/deployment.ts，验收 11/11 全绿。
  关键语义：部署组件数值全取 effective；撤退全额退费 + 冷却；dpRate 加成读 effective.dpBonusRate。
- 2026-11-21 M5 波次胜负完成（commit 9a5ad5e）：src/systems/waves.ts，验收 8/8 全绿。
  关键语义：time 波排期全入队出生后保留（已出生集合标记）；clear 波到点项当场出生不入队；
  锚点=排期链 lastSched+delay，time 严格 > 才开，clear 按条件连续时长 > delay 开。
- 2026-11-21 M8 装配器+网格场景完成（commit 8c2851f）：src/game/battle-glue.ts + src/render/grid-scene.ts。
  关键语义：stepBattle 里 time 累加归装配器；BattleScene 启动参数兼容 {battle}/{setup} 两种；
  每格 setData("cell") 给 M10；registry 约定 battleSpeed/battlePaused；delta 截断 100ms。
- 2026-11-21 M9 精灵血条完成（commit 085d0e8）：src/render/sprites.ts。
  关键语义：容器锚点脚底中心、出生立即定位；阻挡连线按 blockedBy 每帧对账；headless 验证须在单次 evaluate 内轮询（跨 evaluate RAF 节流假死）。
- 2026-11-21 M10 战斗HUD完成（commit 163de57）：src/render/battle-hud.ts。
  关键语义：部署模式=点卡片→canDeploy 格子描边→点格部署；撤退=点干员格子弹面板；
  倍速/暂停写 registry；battleEnded 锁交互+结算面板（emit "battle-finished" 给 M11）。
  Phaser 坑：gameobjectdown 传单个对象；卡片点击必须排除在 blank-down 之外。
- 2026-11-21 M12-M15 内容包完成（commits 637c24e/0e06ce1/1f0258c/efd2ebf）：干员 8 职业 / 敌人 7 含BOSS / 收藏品 30 / 关卡 5 含BOSS关。
- 2026-11-21 M16 整合完成（94313eb→516cb7d）：Boot 标题+localStorage 断点续跑、平衡矩阵全达标、医疗治疗机制（combat 按 profession 分流）、headless 全流程回归 0 报错。95 tests 全绿，项目全部完成。
