/**
 * M7 商店·招募·事件 验收测试（src/meta/run-ops.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "../helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m7.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  recruitCost, recruitOperator, promoteOperator,
  generateShopItems, resolveEvent
} from "../../src/meta/run-ops";
import { createRng } from "../../src/contracts";
import type { EventDef, RelicDef } from "../../src/contracts";
import { makeRunState, RUN_CONFIG, OPERATOR_DEFS } from "../helpers";
import eventsJson from "../../src/data/events.json";
import relicsJson from "../../src/data/relics.json";

const EVENTS: Record<string, EventDef> = Object.fromEntries(
  (eventsJson as EventDef[]).map(e => [e.id, e])
);
const RELIC_IDS = (relicsJson as RelicDef[]).map(r => r.id);

describe("M7 招募", () => {
  it("招募费用按星级查表", () => {
    expect(recruitCost(3, RUN_CONFIG.recruitCostByRarity)).toBe(0);
    expect(recruitCost(4, RUN_CONFIG.recruitCostByRarity)).toBe(2);
    expect(recruitCost(6, RUN_CONFIG.recruitCostByRarity)).toBe(6);
  });

  it("招募成功：扣希望、入队伍；重复招募允许", () => {
    const s = makeRunState({ hope: 6 });
    expect(recruitOperator(s, "op_guard_01", RUN_CONFIG.recruitCostByRarity, 4, OPERATOR_DEFS)).toBe(true);
    expect(s.hope).toBe(6 - 2);
    expect(s.squad).toContain("op_guard_01");
    expect(recruitOperator(s, "op_guard_01", RUN_CONFIG.recruitCostByRarity, 4, OPERATOR_DEFS)).toBe(true);
    expect(s.squad.filter(x => x === "op_guard_01")).toHaveLength(2);
    expect(s.hope).toBe(2);
  });

  it("希望不足招募失败且状态不变", () => {
    const s = makeRunState({ hope: 1 });
    expect(recruitOperator(s, "op_guard_01", RUN_CONFIG.recruitCostByRarity, 4, OPERATOR_DEFS)).toBe(false);
    expect(s.hope).toBe(1);
    expect(s.squad).toHaveLength(0);
  });

  it("队伍满编时招募进入后备，同样扣希望", () => {
    const s = makeRunState({ hope: 6, squad: ["op_guard_01"] });
    expect(recruitOperator(s, "op_sniper_01", RUN_CONFIG.recruitCostByRarity, 1, OPERATOR_DEFS)).toBe(true);
    expect(s.squad).toHaveLength(1);
    expect(s.reserve).toContain("op_sniper_01");
    expect(s.hope).toBe(6 - 2);
  });

  it("低星干员 0 希望可白嫖", () => {
    const s = makeRunState({ hope: 0 });
    expect(recruitOperator(s, "op_sniper_01", RUN_CONFIG.recruitCostByRarity, 4, OPERATOR_DEFS)).toBe(true);
    expect(s.hope).toBe(0);
  });
});

describe("M7 进阶", () => {
  it("进阶消耗希望且只可一次", () => {
    const s = makeRunState({ hope: 5, squad: ["op_guard_01"] });
    expect(promoteOperator(s, "op_guard_01", RUN_CONFIG.promoteCostByRarity)).toBe(true);
    expect(s.hope).toBe(5 - 1);
    expect(s.promoted["op_guard_01"]).toBe(true);
    expect(promoteOperator(s, "op_guard_01", RUN_CONFIG.promoteCostByRarity)).toBe(false);
    expect(s.hope).toBe(4);
  });

  it("未持有的干员无法进阶", () => {
    const s = makeRunState({ hope: 9 });
    expect(promoteOperator(s, "op_sniper_01", RUN_CONFIG.promoteCostByRarity)).toBe(false);
    expect(s.hope).toBe(9);
  });
});

describe("M7 商店", () => {
  const pools = { relicIds: RELIC_IDS, professions: ["sniper", "guard"], operatorIds: ["op_vanguard_01"] };

  it("同 seed 生成结果一致", () => {
    const a = generateShopItems(createRng(42), 2, pools);
    const b = generateShopItems(createRng(42), 2, pools);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("生成 4 件商品，id 唯一、价格合法", () => {
    const items = generateShopItems(createRng(7), 1, pools);
    expect(items.length).toBe(4);
    const ids = new Set(items.map(i => i.id));
    expect(ids.size).toBe(4);
    for (const item of items) {
      expect(item.cost).toBeGreaterThan(0);
      expect(["relic", "ticket", "promotion", "life", "operator"]).toContain(item.kind);
      if (item.kind === "relic") expect(pools.relicIds).toContain(item.payloadId);
      if (item.kind === "ticket") expect(pools.professions).toContain(item.payloadId);
    }
  });

  it("楼层越高收藏品价格越贵", () => {
    const cheap = generateShopItems(createRng(100), 1, pools).map(i => i.cost);
    const pricey = generateShopItems(createRng(100), 4, pools).map(i => i.cost);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(pricey)).toBeGreaterThan(avg(cheap));
  });
});

describe("M7 事件", () => {
  it("满足条件时执行效果并返回", () => {
    const s = makeRunState({ hope: 6, ingots: 10 });
    const applied = resolveEvent(s, EVENTS["ev_wanderer"], 0, createRng(1), RELIC_IDS, 4);
    expect(applied).not.toBeNull();
    expect(s.ingots).toBe(8);
    expect(s.hope).toBe(7);
    expect(applied!.length).toBe(2);
  });

  it("条件不满足返回 null 且状态不变", () => {
    const s = makeRunState({ ingots: 1 });
    expect(resolveEvent(s, EVENTS["ev_wanderer"], 0, createRng(1), RELIC_IDS, 4)).toBeNull();
    expect(s.ingots).toBe(1);
  });

  it("空效果选项合法（离开类）", () => {
    const s = makeRunState();
    const applied = resolveEvent(s, EVENTS["ev_wanderer"], 1, createRng(1), RELIC_IDS, 4);
    expect(applied).toEqual([]);
    expect(s.hope).toBe(RUN_CONFIG.runStart.hope);
  });

  it("随机收藏品效果：从奖池中挑选并进入背包", () => {
    const s = makeRunState({ ingots: 10 });
    const applied = resolveEvent(s, EVENTS["ev_blood_moon_bet"], 0, createRng(99), RELIC_IDS, 4);
    expect(applied).not.toBeNull();
    expect(s.relics).toHaveLength(1);
    expect(RELIC_IDS).toContain(s.relics[0]);
    // 同一 seed 结果可复现
    const s2 = makeRunState({ ingots: 10 });
    resolveEvent(s2, EVENTS["ev_blood_moon_bet"], 0, createRng(99), RELIC_IDS, 4);
    expect(s2.relics).toEqual(s.relics);
  });

  it("获得干员效果：优先入队，满编入后备", () => {
    const ev: EventDef = {
      id: "ev_test_op",
      title: "测试",
      text: "测试",
      options: [{ text: "招募", effects: [{ kind: "operator", op: "add", value: "op_vanguard_01" }] }]
    };
    const s = makeRunState({ squad: ["op_guard_01"] });
    resolveEvent(s, ev, 0, createRng(1), RELIC_IDS, 1);
    expect(s.reserve).toContain("op_vanguard_01");
    const s2 = makeRunState();
    resolveEvent(s2, ev, 0, createRng(1), RELIC_IDS, 4);
    expect(s2.squad).toContain("op_vanguard_01");
  });
});
