# RedShadow —— 傀影与猩红孤钻风格肉鸽塔防

用 Phaser 3 + TypeScript + 自研轻量 ECS 复刻「明日方舟：集成战略」的核心玩法：
塔防战斗 + 肉鸽节点图 + 希望招募 + 收藏品词条。素材与命名全部原创（火柴人占位美术）。

## 快速开始

```bash
env -u NODE_OPTIONS npm install    # 安装依赖（WorkBuddy 沙箱内必须带 env -u NODE_OPTIONS）
env -u NODE_OPTIONS npm run dev    # 本地运行
env -u NODE_OPTIONS npm test       # 全部验收测试
env -u NODE_OPTIONS npm run check  # 类型检查
env -u NODE_OPTIONS npm run validate:data  # 内容包结构校验
```

## 架构一览

```
内容层  src/data/*.json      干员/敌人/收藏品/关卡/事件 —— 扩内容只加 JSON
表现层  src/render/          Phaser 薄渲染：数据→画面，不含规则逻辑
逻辑层  src/systems/ + src/meta/  纯 TS：战斗结算/寻路/部署/词条/波次/节点图/商店
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

推荐顺序（里程碑 A 单关可玩 → B 肉鸽闭环 → C 内容扩展）：

```
M1 战斗结算 → M2 寻路 → M3 部署费用 → M5 波次胜负 → M4 词条结算
→ M6 节点地图 → M7 商店招募
→ M8 网格场景(含战斗装配) → M9 精灵血条 → M10 战斗HUD → M11 肉鸽界面
→ M12~M15 内容包（干员/敌人/收藏品/关卡）
→ M16 最终整合（大模型执行）
```

## 目录速查

| 路径 | 说明 |
|---|---|
| `src/contracts/` | 冻结合同：types.ts 全量类型 / ecs.ts / events.ts / rng.ts |
| `src/data/` | 内容包（M12–M15 在此扩充） |
| `tests/` | 生效验收测试 + helpers.ts 夹具 |
| `tests/pending/` | M1–M7 待启用验收用例（交付后移入 tests/） |
| `specs/` | 16 份模块 SPEC + 协作手册 README.md |
| `scripts/validate-data.ts` | 数据包结构校验（内容包的机器验收） |
