/**
 * rng.ts —— 可注入种子随机数（合同层，冻结）
 *
 * 肉鸽必须可复现：同一 seed 产生同一节点图 / 同一商店 / 同一掉落。
 * 所有需要随机数的模块只许使用本实现（通过参数注入），禁止直接用 Math.random。
 * 算法：mulberry32，体积小、结果稳定可复现。
 */

export interface Rng {
  /** [0,1) 浮点 */
  next(): number;
  /** [min,max] 闭区间整数 */
  int(min: number, max: number): number;
  /** 按权重挑选下标；weights 无需归一 */
  weighted(weights: ReadonlyArray<number>): number;
  /** 等概率取数组元素；空数组抛错 */
  pick<T>(arr: ReadonlyArray<T>): T;
  /** 原地打乱（Fisher-Yates），返回同一数组引用 */
  shuffle<T>(arr: T[]): T[];
  /** 以概率 p 返回 true */
  chance(p: number): boolean;
  /** 当前内部状态（可用于持久化断点续跑） */
  state(): number;
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error(`rng: seed 必须为非负整数，收到 ${seed}`);
  }
  // mulberry32
  let s = seed >>> 0;

  const rng: Rng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    int(min, max) {
      if (max < min) throw new Error(`rng: int(${min},${max}) 区间非法`);
      return min + Math.floor(rng.next() * (max - min + 1));
    },

    weighted(weights) {
      if (weights.length === 0) throw new Error("rng: weighted 空权重数组");
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) throw new Error("rng: weighted 总权重必须为正");
      let roll = rng.next() * total;
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll < 0) return i;
      }
      return weights.length - 1;
    },

    pick(arr) {
      if (arr.length === 0) throw new Error("rng: pick 空数组");
      return arr[rng.int(0, arr.length - 1)];
    },

    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },

    chance(p) {
      return rng.next() < p;
    },

    state() {
      return s;
    }
  };

  return rng;
}
