/**
 * M16 save —— 探索局存档（localStorage 序列化，纯逻辑层，不碰 Phaser）
 *
 * 设计：
 * - RunState 本身是纯 POJO（nodeMap 也是），直接 JSON.stringify 即可；
 * - 存档点：新开局时 / RogueScene create 拿到 run 时（覆盖战斗归来、面板结算两类变更）
 *   / 探索终局（胜利或失败）清档；
 * - 版本号 saveVersion 守卫：读档时版本不符或字段缺失即视为损坏，返回 null；
 * - 测试环境（node，无 localStorage）下静默降级：save 返回 false，load 返回 null。
 */
import type { RunState } from "../contracts";

/** 存档 key（含全局版本，破坏性改格式时换 key 即可） */
const SAVE_KEY = "redshadow_save";
/** 存档格式版本（结构变更时 +1，旧档直接作废） */
const SAVE_VERSION = 1;

/** 存档外壳：版本 + 局数据 */
interface SaveFile {
  saveVersion: number;
  run: RunState;
}

/** 环境守卫：浏览器外（vitest node 环境）不炸，静默降级 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 存档。返回是否成功（无 localStorage / 序列化异常时 false）。
 * 对象内含函数等不可序列化字段时 JSON.stringify 会丢字段——
 * RunState 目前全 POJO，未来加函数字段前必须先剥离。
 */
export function saveRun(run: RunState): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const file: SaveFile = { saveVersion: SAVE_VERSION, run };
    s.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读档。无档 / 版本不符 / JSON 损坏 / 缺关键字段 → null（调用方按"没有存档"处理）。
 */
export function loadRun(): RunState | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const file = JSON.parse(raw) as Partial<SaveFile>;
    // 版本守卫 + 最低限度结构校验（关键字段存在且类型正确才接受）
    if (file.saveVersion !== SAVE_VERSION || !file.run) return null;
    const r = file.run;
    if (typeof r.seed !== "number" || typeof r.floor !== "number" ||
        !r.nodeMap || !Array.isArray(r.squad) || !Array.isArray(r.eventLog)) {
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

/** 清档（探索终局或主动放弃时调用） */
export function clearRun(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(SAVE_KEY);
  } catch {
    /* 忽略：清档失败无实际影响 */
  }
}
