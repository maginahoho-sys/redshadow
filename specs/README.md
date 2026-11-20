# RedShadow 模块协作手册（P0 产出 · 阅我）

> 本手册是给「人类指挥官」（haphoon）的操作指南：如何把 16 个模块分发给小模型
> （如混元4flash）实现、验收、合入，最终整合成一个可玩的傀影肉鸽。
> **本手册与所有 SPEC 只允许大模型修改，小模型只读。**

## 项目一览

- 技术栈：Vite + Phaser 3 + TypeScript（strict）+ vitest
- 架构：ECS（自研轻量合同层，已冻结）+ 数据驱动 JSON + 逻辑/表现分离
- 主题：明日方舟「集成战略：傀影与猩红孤钻」玩法的原创复刻（素材/命名全部原创占位）

```
RedShadow/
├── src/
│   ├── contracts/        # 【冻结】合同层：types / ecs / events / rng
│   ├── data/             # 内容数据包（M12–M15 在这里扩充）
│   ├── systems/          # 战斗逻辑（M1–M5）
│   ├── meta/             # 肉鸽逻辑（M6–M7）
│   ├── game/             # 战斗装配器（M8 交付）
│   ├── render/           # Phaser 渲染（M8–M11）
│   └── main.ts           # 入口（M16 串联）
├── tests/                # 生效中的验收测试（含 helpers.ts 夹具）
├── tests/pending/        # 待启用验收测试（模块交付后移入 tests/）
├── specs/                # 本目录：每模块一份 SPEC
└── scripts/validate-data.ts  # 数据包结构校验
```

## 分发工作流（每个模块重复一遍）

1. **开一个新对话**（混元4flash），粘贴下面这段开场白 + 对应 SPEC 全文：
   > 你是本项目的 TypeScript 实现工程师。严格按下面的 SPEC 实现模块。
   > 只输出完整代码文件（含中文注释），代码外不要输出任何解释。
   > 禁止 import SPEC 白名单之外的任何模块；禁止安装依赖；禁止修改合同层。
2. 把小模型输出的代码保存到 SPEC 指定的文件路径。
3. 按该 SPEC 的「验收」一节操作。**通用规则**：把 `tests/pending/mX.test.ts`
   移入 `tests/`，同时改两处导入路径（`../../src/` → `../src/`，
   `../helpers` → `./helpers`），然后跑验收命令。
4. 通过 → `git commit -m "feat(mX): 模块名"`；失败 → 把终端报错原样贴回**同一个**
   混元对话让它返工，直到通过。
5. 该模块完成，进入下一个。

## 模块依赖与推荐顺序

```
批次1（纯逻辑，任意顺序）:  M1 战斗结算 → M2 寻路 → M3 部署 → M5 波次 → M4 词条
批次2（肉鸽逻辑）:          M6 节点地图 → M7 商店招募
批次3（内容包，随时可做）:   M12 干员 → M13 敌人 → M14 收藏品 → M15 关卡
批次4（表现层）:            M8 网格场景 → M9 精灵 → M10 战斗HUD → M11 肉鸽界面
批次5（大模型收官）:         M16 整合
```

- **里程碑 A（单关塔防 demo）**：M1→M2→M3→M5→M8→M9→M10 后即可玩一关。
- **里程碑 B（肉鸽闭环）**：加 M4→M6→M7→M11。
- **里程碑 C（内容扩展）**：M12–M15 批量补内容，M16 整合平衡。

## 验收命令速查

| 命令 | 用途 |
|---|---|
| `env -u NODE_OPTIONS npm run test` | 跑全部生效测试 |
| `env -u NODE_OPTIONS npx vitest run tests/mX.test.ts` | 单跑某模块验收 |
| `env -u NODE_OPTIONS npm run check` | 全量类型检查 |
| `env -u NODE_OPTIONS npm run validate:data` | 内容包结构校验（M12–M15） |
| `env -u NODE_OPTIONS npm run dev` | 本地运行游戏 |

> 注意：从 WorkBuddy 沙箱终端跑命令时一律带 `env -u NODE_OPTIONS` 前缀，
> 否则 npm/vitest 会被拖慢或报错。

## 全局铁律（违反 = 验收不通过）

1. **合同层冻结**：`src/contracts/` 与 `tests/helpers.ts` 只许 import，不许修改。
2. **依赖白名单**：每份 SPEC 列出允许 import 的文件，越界即退回。
3. **单文件交付**：每个逻辑模块一个 `.ts` 文件，≤ 500 行；中文注释。
4. **逻辑不碰 Phaser**：M1–M7 严禁出现 `import Phaser` 或任何 DOM/渲染 API。
5. **随机必须可复现**：只用注入的 `Rng`，严禁 `Math.random()`。
6. **测试即合同**：交付代码必须让对应验收测试全绿，且不许改测试文件。

## 版权约束

- 不使用明日方舟官方美术、音频、干员名、地名与文案原文。
- 玩法机制（塔防+肉鸽）不受版权保护，数值与命名全部原创（可用致敬风格）。
