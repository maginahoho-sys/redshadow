/**
 * M6 肉鸽节点地图生成
 *
 * 按层生成「多入口汇聚到 BOSS」的分层分支节点图（有向无环）。
 * 结构为固定 3 段式：start（battle）→ 中段两列交错的普通节点 → boss。
 * 普通节点类型从权重表用 rng.weighted 抽样；同 seed 完全可复现。
 */
import type { NodeType, MapNode, NodeMap, Rng } from "../contracts";

/** 楼层配置（由 run-config.floors 提供） */
export interface FloorConfig {
  floorName: string;
  /** 普通节点数量区间（含 start，不含 boss） */
  nodeCountRange: [number, number];
  /** 非战斗节点权重表（battle 权重缺省算 1） */
  weights: Partial<Record<NodeType, number>>;
}

/**
 * 生成一层的节点地图。
 *
 * 不变量（验收逐条检查）：
 * - 所有节点从 start 可达，boss 可达且 next 为空；
 * - 无环（分层结构天然保证：边只从第 k 排指向第 k+1 排）；
 * - next 引用的 id 必须存在；
 * - 普通节点类型只能来自 weights 的键（start 固定 battle）。
 */
export function generateNodeMap(floor: number, cfg: FloorConfig, rng: Rng): NodeMap {
  // 1) 普通节点数（含 start）：区间内抽样；至少 2（start + 1 个中段节点）
  const normalCount = Math.max(2, rng.int(cfg.nodeCountRange[0], cfg.nodeCountRange[1]));
  const middleCount = normalCount - 1;

  // 2) 权重表 → 抽样数组：battle 缺省 1；全 0 时兜底只用 battle
  const keys = Object.keys(cfg.weights) as NodeType[];
  if (!keys.includes("battle")) keys.push("battle");
  const weightList = keys.map(k => {
    const w = cfg.weights[k];
    return k === "battle" ? (w ?? 1) : (w ?? 0);
  });
  const totalWeight = weightList.reduce((s, w) => s + w, 0);
  /** 抽一个普通节点类型；权重和为 0 时兜底 battle */
  const sampleType = (): NodeType => {
    if (totalWeight <= 0) return "battle";
    return keys[rng.weighted(weightList)];
  };

  // 3) 布点：中段每排 2 个（col 0/1），末排可能只有 1 个
  const rows: string[][] = [];
  let seq = 0;
  const nextId = (): string => `n${floor}_${seq++}`;

  // start：第 0 排，col 0.5（渲染居中），类型固定 battle
  const startId = nextId();
  const nodes: Record<string, MapNode> = {
    [startId]: { id: startId, type: "battle", row: 0, col: 0.5, next: [] }
  };

  // 中段：排数 = ceil(middleCount / 2)，按 row-major 顺序创建并抽样类型
  for (let placed = 0; placed < middleCount; ) {
    const rowNodes: string[] = [];
    for (const col of [0, 1]) {
      if (placed >= middleCount) break;
      const id = nextId();
      nodes[id] = { id, type: sampleType(), row: rows.length + 1, col, next: [] };
      rowNodes.push(id);
      placed++;
    }
    rows.push(rowNodes);
  }

  // boss：最末排之后，col 0.5，无后继
  const bossId = nextId();
  const bossRow = rows.length + 1;
  nodes[bossId] = { id: bossId, type: "boss", row: bossRow, col: 0.5, next: [] };

  // 4) 连边：只从第 k 排连向第 k+1 排（分层 → 天然无环）
  //    start → 首排全部；中段第 k 排每个节点 → 第 k+1 排全部（1~2 个）；
  //    末排 → boss。
  const link = (from: string, tos: string[]): void => {
    nodes[from].next.push(...tos);
  };
  for (let r = 0; r < rows.length; r++) {
    const targets = r + 1 < rows.length ? rows[r + 1] : [bossId];
    for (const from of rows[r]) link(from, targets);
  }
  link(startId, rows[0]);

  return { floor, floorName: cfg.floorName, nodes, start: startId, boss: bossId };
}
