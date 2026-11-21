# RedShadow —— 猩红孤钻（肉鸽塔防）

用 Phaser 3 + TypeScript + 自研轻量 ECS 复刻「明日方舟：集成战略」的核心玩法：
塔防战斗 + 肉鸽节点图 + 希望招募 + 收藏品词条。素材与命名全部原创（火柴人占位美术）。

## 玩法

- **标题画面** → 选分队 → 进入 5 层探索：每层一张节点图（作战 / 紧急作战 / 行商 / 偶遇 / 馈赠 / 安全角落 / 幕间余兴 → 首领压轴）；
- **战斗**：点底部干员卡片 → 点格子部署（近战地面 / 远程高台），敌人沿路径推进，漏怪扣目标生命；倍速 / 暂停 / 撤退一应俱全；
- **成长**：作战胜利得希望 / 源石锭 / 概率收藏品；行商花源石锭买东西；幕间余兴给职业招募券，进图用希望招募干员、进阶提升属性；
- **收藏品**：30 件声明式词条（职业定向 / 标签定向 / 全局经济 / 敌人削弱 / 组合技 / 负面收藏品），纯 JSON 扩展；
- **存档**：浏览器 localStorage 断点续跑，刷新后可「继续探索」；探索终局（通关或失败）自动清档；
- **终局**：击败第 5 层首领 → 探索胜利；目标生命归零 → 探索失败。

## 快速开始

```bash
env -u NODE_OPTIONS npm install    # 安装依赖（WorkBuddy 沙箱内必须带 env -u NODE_OPTIONS）
env -u NODE_OPTIONS npm run dev    # 本地运行 http://localhost:5173
env -u NODE_OPTIONS npm test       # 全部验收测试
env -u NODE_OPTIONS npm run check  # 类型检查
env -u NODE_OPTIONS npm run validate:data  # 内容包结构校验
env -u NODE_OPTIONS npm run build  # 产物 dist/，可任意静态托管
```

## 架构一览

```
内容层  src/data/*.json      干员/敌人/收藏品/关卡/事件 —— 扩内容只加 JSON
表现层  src/render/          Phaser 薄渲染：数据→画面，不含规则逻辑
逻辑层  src/systems/ + src/meta/  纯 TS：战斗结算/寻路/部署/词条/波次/节点图/商店/存档
合同层  src/contracts/       types + 轻量 ECS + 事件总线 + 种子随机 —— 已冻结
装配层  src/game/            battle-glue：把系统按固定顺序组装成一场战斗
```

**核心设计**：合同先行（contract-first）。
- 合同层由 P0 一次性产出并冻结，所有模块只许 import 不许修改；
- 逻辑层不 import Phaser，vitest 直接验收，渲染层只做"状态→Sprite"映射；
- 干员/敌人/收藏品全部数据驱动，词条是声明式 RelicMod，
  扩到千种收藏品 = 加千份 JSON，逻辑零改动。

## 模块协作（本项目怎么用小模型开发）

每个模块一份自包含 SPEC（`specs/m1-*.md` ~ `m16-*.md`），开一个新对话贴给
小模型实现 → 按 SPEC 验收（测试文件从 `tests/pending/` 移入 `tests/`）→
通过则 git commit。**完整操作手册见 `specs/README.md`。**

里程碑（A 单关可玩 → B 肉鸽闭环 → C 内容扩展 → M16 整合收官，全部完成）：

```
M1 战斗结算 → M2 寻路 → M3 部署费用 → M5 波次胜负 → M4 词条结算
→ M6 节点地图 → M7 商店招募
→ M8 网格场景(含战斗装配) → M9 精灵血条 → M10 战斗HUD → M11 肉鸽界面
→ M12~M15 内容包（干员 8 / 敌人 7 / 收藏品 30 / 关卡 5）
→ M16 最终整合：Boot 标题 + 存档续跑 + 平衡回归 + 医疗机制（已完成）
```

## 目录速查

| 路径 | 说明 |
|---|---|
| `src/contracts/` | 冻结合同：types.ts 全量类型 / ecs.ts / events.ts / rng.ts |
| `src/data/` | 内容包（干员 8 / 敌人 7 / 收藏品 30 / 关卡 5 / 事件 3） |
| `src/render/` | boot-scene（标题）/ rogue-ui（探索）/ grid-scene + sprites + battle-hud（战斗） |
| `src/meta/save.ts` | localStorage 存档（saveVersion 守卫） |
| `tests/` | 生效验收测试 + helpers.ts 夹具 |
| `specs/` | 16 份模块 SPEC + 协作手册 README.md |
| `scripts/validate-data.ts` | 数据包结构校验（内容包的机器验收） |
| `scripts/sim-balance.ts` | 平衡回归模拟器（贪心自动部署逐关试玩） |

## 调试口

浏览器 console 可用：
- `__game`：Phaser.Game 实例（场景/registry 控制）；
- `__battleApi`：`canDeploy / deployOperator / stepBattle / saveRun / battle()`（战斗自动化与存档操作）。
