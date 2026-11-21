/**
 * M7 招募·进阶·商店·事件结算（肉鸽探索层资源操作，纯逻辑）
 *
 * 说明：promoteOperator 的签名不含干员定义表，星级只能从数据文件查——
 * 这里 import operators.json 做 id→rarity 映射（数据驱动，不硬编码任何 id），
 * 是对 SPEC 白名单的最小偏离，已获主会话确认。
 */
import type {
  RunState,
  OperatorDef,
  EventDef,
  EventEffect,
  ShopItem,
  Rng
} from "../contracts";
import operatorsJson from "../data/operators.json";

/** 干员 id → 星级（进阶费用按此查表） */
const RARITY_BY_ID: Record<string, number> = Object.fromEntries(
  (operatorsJson as unknown as OperatorDef[]).map(o => [o.id, o.rarity])
);

// ============================================================
// 招募
// ============================================================

/** 按星级查招募希望消耗；表里没有的星级按 999（基本不可负担） */
export function recruitCost(rarity: number, costTable: Record<string, number>): number {
  return costTable[String(rarity)] ?? 999;
}

/**
 * 招募：扣希望、入队/入后备；希望不足或干员不存在返回 false（状态不变）。
 * 允许重复招募同一干员（凑编队的肉鸽特色）。
 */
export function recruitOperator(
  state: RunState,
  operatorId: string,
  costTable: Record<string, number>,
  squadLimit: number,
  operatorDefs: Record<string, OperatorDef>
): boolean {
  const def = operatorDefs[operatorId];
  if (!def) return false;
  const cost = recruitCost(def.rarity, costTable);
  if (state.hope < cost) return false;

  state.hope -= cost;
  if (state.squad.length < squadLimit) state.squad.push(operatorId);
  else state.reserve.push(operatorId);
  state.eventLog.push(`招募了干员 ${operatorId}（${cost} 希望）`);
  return true;
}

// ============================================================
// 进阶
// ============================================================

/**
 * 进阶：扣希望、标记 promoted；未持有/已进阶/希望不足返回 false。
 * 3 星及以下无法进阶（promote 表里没有对应键，自然返回 false）。
 */
export function promoteOperator(
  state: RunState,
  operatorId: string,
  promoteTable: Record<string, number>
): boolean {
  if (state.promoted[operatorId]) return false;
  const held = state.squad.includes(operatorId) || state.reserve.includes(operatorId);
  if (!held) return false;
  const cost = promoteTable[String(RARITY_BY_ID[operatorId] ?? 999)];
  if (cost === undefined) return false;
  if (state.hope < cost) return false;

  state.hope -= cost;
  state.promoted[operatorId] = true;
  state.eventLog.push(`进阶了干员 ${operatorId}（${cost} 希望）`);
  return true;
}

// ============================================================
// 商店
// ============================================================

/** 商店奖池 */
export interface ShopPools {
  relicIds: string[];     // 收藏品奖池
  professions: string[];  // 可出现的职业券
  operatorIds: string[];  // 可出现的干员
}

const SHOP_KINDS: ShopItem["kind"][] = ["relic", "ticket", "promotion", "life", "operator"];

/**
 * 生成一批商店商品（固定 4 件，同 rng 序列完全可复现）。
 * kind 等概率抽取，但保证至少 1 件 relic（无则把第一件替换成 relic）。
 */
export function generateShopItems(rng: Rng, floor: number, pools: ShopPools): ShopItem[] {
  // 1) 抽 4 个 kind；保证至少 1 件 relic
  const kinds: ShopItem["kind"][] = [];
  for (let i = 0; i < 4; i++) kinds.push(SHOP_KINDS[rng.int(0, SHOP_KINDS.length - 1)]);
  if (!kinds.includes("relic")) kinds[0] = "relic";

  // 2) 按序生成商品（payload 与定价的 rng 调用顺序固定 → 可复现）
  const items: ShopItem[] = [];
  for (let i = 0; i < 4; i++) {
    const kind = kinds[i];
    let payloadId = "";
    let cost = 0;
    switch (kind) {
      case "relic":
        payloadId = pools.relicIds.length > 0 ? rng.pick(pools.relicIds) : "";
        cost = 8 + floor * 3 + rng.int(0, 8);  // 简式定价（SPEC 推荐）
        break;
      case "ticket":
        payloadId = pools.professions.length > 0 ? rng.pick(pools.professions) : "high";
        cost = 8 + floor * 2 + rng.int(0, 4);
        break;
      case "promotion":
        payloadId = pools.operatorIds.length > 0 ? rng.pick(pools.operatorIds) : "";
        cost = 10 + floor * 2;
        break;
      case "life":
        payloadId = "life";
        cost = 6;
        break;
      case "operator":
        payloadId = pools.operatorIds.length > 0 ? rng.pick(pools.operatorIds) : "";
        cost = 12 + floor * 3;
        break;
    }
    items.push({ id: `shop_${floor}_${i}_${rng.int(0, 99999)}`, kind, payloadId, cost });
  }
  return items;
}

// ============================================================
// 事件结算
// ============================================================

/**
 * 结算事件选项效果；选项越界或条件不满足返回 null 且状态零变化。
 * 返回实际应用的效果数组（空选项返回 []）。
 */
export function resolveEvent(
  state: RunState,
  ev: EventDef,
  optionIndex: number,
  rng: Rng,
  relicPool: string[],
  squadLimit: number
): EventEffect[] | null {
  const option = ev.options[optionIndex];
  if (!option) return null;
  // 前置条件：任一不满足 → null（先检查后应用，保证状态零变化）
  if (option.requireHope !== undefined && state.hope < option.requireHope) return null;
  if (option.requireIngots !== undefined && state.ingots < option.requireIngots) return null;
  if (option.requireHp !== undefined && state.objectiveHp < option.requireHp) return null;

  const applied: EventEffect[] = [];
  for (const effect of option.effects) {
    if (applyEffect(state, effect, rng, relicPool, squadLimit)) applied.push(effect);
  }
  return applied;
}

/**
 * 应用单条效果；返回是否实际生效。
 * hope/ingots 不允许扣成负数（会成负则跳过）；hp 夹紧 [0, objectiveHpCap]。
 */
function applyEffect(
  state: RunState,
  effect: EventEffect,
  rng: Rng,
  relicPool: string[],
  squadLimit: number
): boolean {
  if (effect.op === "remove") return applyRemove(state, effect);
  // op = add
  switch (effect.kind) {
    case "hope":
    case "ingots": {
      const delta = effect.value as number;
      const cur = effect.kind === "hope" ? state.hope : state.ingots;
      if (cur + delta < 0) return false; // 扣成负数 → 跳过
      if (effect.kind === "hope") state.hope = cur + delta;
      else state.ingots = cur + delta;
      return true;
    }
    case "hp": {
      state.objectiveHp = Math.max(0, Math.min(state.objectiveHpCap, state.objectiveHp + (effect.value as number)));
      return true;
    }
    case "relic": {
      const id = effect.value === "random" ? rng.pick(relicPool) : (effect.value as string);
      state.relics.push(id);
      state.eventLog.push(`事件中获得收藏品 ${id}`);
      return true;
    }
    case "ticket": {
      state.recruitTickets.push(effect.value as string);
      return true;
    }
    case "operator": {
      const id = effect.value as string;
      if (state.squad.length < squadLimit) state.squad.push(id);
      else state.reserve.push(id);
      state.eventLog.push(`事件中获得干员 ${id}`);
      return true;
    }
    default:
      return false;
  }
}

/** remove 效果：从对应列表移除第一个匹配项（relic/operator），不存在则忽略 */
function applyRemove(state: RunState, effect: EventEffect): boolean {
  const id = effect.value as string;
  if (effect.kind === "relic") {
    const i = state.relics.indexOf(id);
    if (i >= 0) { state.relics.splice(i, 1); return true; }
    return false;
  }
  if (effect.kind === "operator") {
    let i = state.squad.indexOf(id);
    if (i >= 0) { state.squad.splice(i, 1); return true; }
    i = state.reserve.indexOf(id);
    if (i >= 0) { state.reserve.splice(i, 1); return true; }
    return false;
  }
  return false;
}
