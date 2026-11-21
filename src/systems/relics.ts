/**
 * M4 收藏品词条结算系统
 *
 * 把收藏品/分队的声明式词条（RelicMod）通用求值为：
 *  - 干员有效属性表 buildOperatorEffective
 *  - 敌人克隆表 buildEnemyDefs（不改原定义）
 *  - 战斗全局参数 buildGlobals
 *  - 探索局初始资源 runStartFrom
 *
 * 核心规则：同一实体同一属性，先汇总全部 add，再连乘全部 mul。
 * 本模块不含任何具体收藏品名字——千种收藏品 = 千份 JSON，逻辑零改动。
 */
import type {
  EntitySelector,
  Faction,
  Profession,
  RelicMod,
  OperatorDef,
  EnemyDef,
  EffectiveStats,
  EffectiveGlobals,
  StatKey,
  RunStatKey
} from "../contracts";

// ============================================================
// 选择器匹配
// ============================================================

/**
 * 选择器匹配。subject: { faction, profession?, tags }。
 * 各条件之间取交集；未给出的条件不做限制。
 */
export function matches(
  selector: EntitySelector,
  subject: { faction: Faction; profession?: Profession; tags: string[] }
): boolean {
  // 阵营：缺省 = 双方
  if (selector.faction !== undefined && selector.faction !== subject.faction) return false;
  // 职业：仅干员有；选择器给了 professions 而主体无职业 → 不命中
  if (selector.professions !== undefined) {
    if (subject.profession === undefined || !selector.professions.includes(subject.profession)) {
      return false;
    }
  }
  // 标签全含
  if (selector.tagsAll !== undefined) {
    for (const t of selector.tagsAll) {
      if (!subject.tags.includes(t)) return false;
    }
  }
  // 标签任一命中
  if (selector.tagsAny !== undefined && selector.tagsAny.length > 0) {
    if (!selector.tagsAny.some(t => subject.tags.includes(t))) return false;
  }
  return true;
}

// ============================================================
// 数值求值内核：先汇总 add，再连乘 mul
// ============================================================

/**
 * 对基准值应用一组同属性的 stat 词条（已筛选出命中项）。
 * 结果 = (base + Σadd) × Πmul。
 */
function applyStatOps(base: number, mods: ReadonlyArray<Extract<RelicMod, { kind: "stat" }>>): number {
  let value = base;
  for (const m of mods) if (m.op === "add") value += m.value;
  for (const m of mods) if (m.op === "mul") value *= m.value;
  return value;
}

/** 从词条列表中筛出「kind=stat 且命中 subject 且目标属性为 statKey」的子集 */
function pickStatMods(
  mods: readonly RelicMod[],
  subject: { faction: Faction; profession?: Profession; tags: string[] },
  statKey: StatKey
): Extract<RelicMod, { kind: "stat" }>[] {
  const picked: Extract<RelicMod, { kind: "stat" }>[] = [];
  for (const m of mods) {
    if (m.kind === "stat" && m.stat === statKey && matches(m.selector, subject)) {
      picked.push(m);
    }
  }
  return picked;
}

/** 收集命中 subject 的 grantTag 词条的 tag（保持词条顺序） */
function pickGrantTags(
  mods: readonly RelicMod[],
  subject: { faction: Faction; profession?: Profession; tags: string[] }
): string[] {
  const tags: string[] = [];
  for (const m of mods) {
    if (m.kind === "grantTag" && matches(m.selector, subject)) tags.push(m.tag);
  }
  return tags;
}

/** 干员实体匹配 subject（合同约定：faction=operator + profession + 基准 tags） */
function opSubject(def: OperatorDef): { faction: Faction; profession: Profession; tags: string[] } {
  return { faction: "operator", profession: def.profession, tags: [...(def.tags ?? [])] };
}

// ============================================================
// 干员有效属性
// ============================================================

/**
 * 求值干员有效属性表：base ← defs，应用全部 stat/grantTag 词条。
 * dpBonusRate 缺省 0；grantTag 追加进 tags（基准 tags 顺序在前，新 tag 去重）。
 */
export function buildOperatorEffective(
  defs: OperatorDef[],
  mods: readonly RelicMod[]
): Record<string, EffectiveStats> {
  const out: Record<string, EffectiveStats> = {};
  for (const def of defs) {
    const subject = opSubject(def);
    // 各属性统一走 applyStatOps（add 汇总 → mul 连乘）
    const stat = (key: StatKey, base: number): number => applyStatOps(base, pickStatMods(mods, subject, key));
    // grantTag：追加到基准 tags 之后，去重
    const tags = [...(def.tags ?? [])];
    for (const t of pickGrantTags(mods, subject)) {
      if (!tags.includes(t)) tags.push(t);
    }
    out[def.id] = {
      cost: stat("cost", def.cost),
      hp: stat("hp", def.hp),
      atk: stat("atk", def.atk),
      def: stat("def", def.def),
      res: stat("res", def.res),
      attackInterval: stat("attackInterval", def.attackInterval),
      blockCount: stat("blockCount", def.blockCount),
      damageType: def.damageType,
      range: def.range,
      redeployCooldown: stat("redeployCooldown", def.redeployCooldown),
      dpBonusRate: def.dpBonusRate ?? 0,
      tags
    };
  }
  return out;
}

// ============================================================
// 敌人克隆表
// ============================================================

/**
 * 求值敌人克隆表：返回全新的对象（浅拷贝 + 数值覆盖），原始 defs 不被改动。
 * 敌人可命中的 StatKey 仅 hp/atk/def/res/speed；grantTag 合并进 tags。
 */
export function buildEnemyDefs(
  defs: EnemyDef[],
  mods: readonly RelicMod[]
): Record<string, EnemyDef> {
  const out: Record<string, EnemyDef> = {};
  for (const def of defs) {
    const subject = { faction: "enemy" as Faction, tags: [...(def.tags ?? [])] };
    const stat = (key: StatKey, base: number): number => applyStatOps(base, pickStatMods(mods, subject, key));
    // grantTag：合并进克隆的 tags（基准在前，去重）
    const tags = [...(def.tags ?? [])];
    for (const t of pickGrantTags(mods, subject)) {
      if (!tags.includes(t)) tags.push(t);
    }
    out[def.id] = {
      ...def,
      hp: stat("hp", def.hp),
      atk: stat("atk", def.atk),
      def: stat("def", def.def),
      res: stat("res", def.res),
      speed: stat("speed", def.speed),
      tags
    };
  }
  return out;
}

// ============================================================
// 战斗全局参数
// ============================================================

/**
 * 求值战斗全局参数：只认 kind=global 词条，先 add 后 mul，base 为基准。
 */
export function buildGlobals(base: EffectiveGlobals, mods: readonly RelicMod[]): EffectiveGlobals {
  const picked: Extract<RelicMod, { kind: "global" }>[] = [];
  for (const m of mods) if (m.kind === "global") picked.push(m);

  const evalKey = (target: keyof EffectiveGlobals, baseValue: number): number => {
    const hits = picked.filter(m => m.target === target);
    let value = baseValue;
    for (const m of hits) if (m.op === "add") value += m.value;
    for (const m of hits) if (m.op === "mul") value *= m.value;
    return value;
  };

  return {
    dpRate: evalKey("dpRate", base.dpRate),
    initialDp: evalKey("initialDp", base.initialDp),
    objectiveHp: evalKey("objectiveHp", base.objectiveHp),
    tempObjectiveHp: evalKey("tempObjectiveHp", base.tempObjectiveHp),
    squadSize: evalKey("squadSize", base.squadSize)
  };
}

// ============================================================
// 探索局初始资源
// ============================================================

/**
 * 求值探索局初始资源：只认 kind=runStat 词条（hope/ingots/objectiveHp/hopeCap），
 * 其他 kind 一律忽略。
 */
export function runStartFrom(
  runStart: { hope: number; hopeCap: number; ingots: number; objectiveHp: number },
  mods: readonly RelicMod[]
): { hope: number; hopeCap: number; ingots: number; objectiveHp: number } {
  const picked: Extract<RelicMod, { kind: "runStat" }>[] = [];
  for (const m of mods) if (m.kind === "runStat") picked.push(m);

  const evalKey = (target: RunStatKey, baseValue: number): number => {
    const hits = picked.filter(m => m.target === target);
    let value = baseValue;
    for (const m of hits) if (m.op === "add") value += m.value;
    for (const m of hits) if (m.op === "mul") value *= m.value;
    return value;
  };

  return {
    hope: evalKey("hope", runStart.hope),
    hopeCap: evalKey("hopeCap", runStart.hopeCap),
    ingots: evalKey("ingots", runStart.ingots),
    objectiveHp: evalKey("objectiveHp", runStart.objectiveHp)
  };
}
