/**
 * M6 节点地图生成 验收测试（src/meta/node-map.ts）
 *
 * 交付时：把本文件移到 tests/ 目录，并把 `../../src/` 改回 `../src/`、`from "../helpers"` 改为 `from "./helpers"`，
 * 然后运行：npx vitest run tests/m6.test.ts
 */
import { describe, it, expect } from "vitest";
import { generateNodeMap } from "../../src/meta/node-map";
import { createRng } from "../../src/contracts";
import { RUN_CONFIG } from "../helpers";

const CFG = {
  floorName: "红幕初启",
  nodeCountRange: [3, 4] as [number, number],
  weights: { battle: 5, emergencyBattle: 1, shop: 1.5, event: 2 }
};

/** 从 start 出发沿 next 可达的所有节点 */
function reachable(map: ReturnType<typeof generateNodeMap>): Set<string> {
  const seen = new Set<string>([map.start]);
  const queue = [map.start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nx of map.nodes[cur].next) {
      if (!seen.has(nx)) {
        seen.add(nx);
        queue.push(nx);
      }
    }
  }
  return seen;
}

describe("M6 generateNodeMap", () => {
  it("同 seed 完全一致，不同 seed 结构合法", () => {
    const a = generateNodeMap(1, CFG, createRng(42));
    const b = generateNodeMap(1, CFG, createRng(42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("节点数量在配置区间内，boss 存在且无后继", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateNodeMap(2, CFG, createRng(seed));
      const normalCount = Object.keys(map.nodes).length;
      expect(normalCount).toBeGreaterThanOrEqual(CFG.nodeCountRange[0]);
      expect(normalCount).toBeLessThanOrEqual(CFG.nodeCountRange[1] + 1); // +1 为 boss
      expect(map.nodes[map.boss].type).toBe("boss");
      expect(map.nodes[map.boss].next).toHaveLength(0);
    }
  });

  it("所有节点从 start 可达且能抵达 boss（多 seed 不变量）", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateNodeMap(1, CFG, createRng(seed));
      const seen = reachable(map);
      expect(seen.size).toBe(Object.keys(map.nodes).length);
      expect(seen.has(map.boss)).toBe(true);
    }
  });

  it("无环（DAG）：沿 next 链不会回到自身", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateNodeMap(3, CFG, createRng(seed));
      for (const id of Object.keys(map.nodes)) {
        const visited = new Set<string>([id]);
        const queue = [...map.nodes[id].next];
        let cyclic = false;
        while (queue.length > 0 && !cyclic) {
          const cur = queue.shift()!;
          if (visited.has(cur)) { cyclic = true; break; }
          visited.add(cur);
          queue.push(...map.nodes[cur].next);
        }
        expect(cyclic).toBe(false);
      }
    }
  });

  it("next 引用的节点必须存在", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateNodeMap(1, CFG, createRng(seed));
      for (const node of Object.values(map.nodes)) {
        for (const nx of node.next) {
          expect(map.nodes[nx]).toBeDefined();
        }
      }
    }
  });

  it("节点类型只能来自权重表（boss 除外）", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = generateNodeMap(1, CFG, createRng(seed));
      const allowed = new Set([...Object.keys(CFG.weights), "boss"]);
      for (const node of Object.values(map.nodes)) {
        expect(allowed.has(node.type)).toBe(true);
      }
    }
  });

  it("使用 run-config 楼层配置也能生成合法地图", () => {
    for (const [i, floor] of RUN_CONFIG.floors.entries()) {
      const map = generateNodeMap(i + 1, floor, createRng(7));
      expect(Object.keys(map.nodes).length).toBeGreaterThan(0);
      expect(map.floorName).toBe(floor.floorName);
      expect(reachable(map).has(map.boss)).toBe(true);
    }
  });
});
