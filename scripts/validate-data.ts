/**
 * validate-data.ts —— 内容数据包结构校验脚本（M12–M15 的机器验收标准）
 *
 * 用法：npm run validate:data
 * 退出码：0 = 全部通过；1 = 存在错误（逐条打印）。
 *
 * 校验范围：
 *   operators.json / enemies.json / relics.json / stages.json / events.json / run-config.json
 * 校验原则：只做结构合法性检查，不做数值平衡检查（平衡由 M16 负责人肉验收）。
 */

import operatorPacks from "../src/data/operators.json";
import enemyPacks from "../src/data/enemies.json";
import relicPacks from "../src/data/relics.json";
import stagePacks from "../src/data/stages.json";
import eventPacks from "../src/data/events.json";
import runConfig from "../src/data/run-config.json";

// ---------- 工具 ----------

const errors: string[] = [];
function fail(file: string, id: string, msg: string): void {
  errors.push(`[${file}] ${id}: ${msg}`);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

const MELEE_PROFESSIONS = ["vanguard", "guard", "defender", "specialist"];
const RANGED_PROFESSIONS = ["sniper", "caster", "medic", "supporter"];
const PROFESSIONS = [...MELEE_PROFESSIONS, ...RANGED_PROFESSIONS];
const STAT_KEYS = ["hp", "atk", "def", "res", "cost", "attackInterval", "blockCount", "speed", "redeployCooldown"];
const GLOBAL_KEYS = ["dpRate", "initialDp", "objectiveHp", "tempObjectiveHp", "squadSize"];
const RUN_STAT_KEYS = ["hope", "ingots", "objectiveHp", "hopeCap"];
const OP = "random"; // relic/ticket 效果占位：随机

/** 收集所有 id，检查全局唯一性与前缀 */
const idOwners = new Map<string, string>();
function checkIdOwner(file: string, id: string, prefix: string): void {
  if (!isStr(id)) {
    fail(file, "(缺 id)", "id 必须为非空字符串");
    return;
  }
  if (!id.startsWith(prefix + "_")) {
    fail(file, id, `id 必须以 "${prefix}_" 开头`);
  }
  if (idOwners.has(id)) {
    fail(file, id, `id 与 ${idOwners.get(id)} 中的重复`);
  } else {
    idOwners.set(id, file);
  }
}

/** 校验 RelicMod 结构 */
function checkMod(file: string, id: string, mod: unknown, index: number): void {
  const tag = `mods[${index}]`;
  if (typeof mod !== "object" || mod === null) {
    fail(file, id, `${tag} 不是对象`);
    return;
  }
  const m = mod as Record<string, unknown>;
  switch (m.kind) {
    case "stat": {
      const selector = m.selector as Record<string, unknown> | undefined;
      if (!selector) { fail(file, id, `${tag}.selector 缺失`); break; }
      if (m.faction !== undefined && !["operator", "enemy"].includes(String(m.faction))) {
        fail(file, id, `${tag}.selector.faction 非法`);
      }
      if (!STAT_KEYS.includes(String(m.stat))) fail(file, id, `${tag}.stat 非法: ${String(m.stat)}`);
      if (!["add", "mul"].includes(String(m.op))) fail(file, id, `${tag}.op 非法`);
      if (!isNum(m.value)) fail(file, id, `${tag}.value 必须为数值`);
      break;
    }
    case "global":
      if (!GLOBAL_KEYS.includes(String(m.target))) fail(file, id, `${tag}.target 非法: ${String(m.target)}`);
      if (!["add", "mul"].includes(String(m.op))) fail(file, id, `${tag}.op 非法`);
      if (!isNum(m.value)) fail(file, id, `${tag}.value 必须为数值`);
      break;
    case "grantTag":
      if (!isStr(m.tag)) fail(file, id, `${tag}.tag 必须为非空字符串`);
      break;
    case "runStat":
      if (!RUN_STAT_KEYS.includes(String(m.target))) fail(file, id, `${tag}.target 非法: ${String(m.target)}`);
      if (!["add", "mul"].includes(String(m.op))) fail(file, id, `${tag}.op 非法`);
      if (!isNum(m.value)) fail(file, id, `${tag}.value 必须为数值`);
      break;
    default:
      fail(file, id, `${tag}.kind 非法: ${String(m.kind)}`);
  }
}

// ---------- operators.json ----------

const operators = operatorPacks as Record<string, unknown>[];
const operatorIds = new Set<string>();
for (const op of operators) {
  const id = String(op.id ?? "(?)");
  checkIdOwner("operators.json", id, "op");
  operatorIds.add(id);
  if (!PROFESSIONS.includes(String(op.profession))) fail("operators.json", id, `profession 非法: ${String(op.profession)}`);
  const expectPlacement = MELEE_PROFESSIONS.includes(String(op.profession)) ? "melee" : "ranged";
  if (op.placement !== expectPlacement) {
    fail("operators.json", id, `placement 应为 "${expectPlacement}"（与 profession 对应）`);
  }
  const rarity = op.rarity;
  if (!isNum(rarity) || rarity < 1 || rarity > 6 || !Number.isInteger(rarity)) fail("operators.json", id, "rarity 必须为 1-6 整数");
  for (const k of ["cost", "hp", "atk", "attackInterval", "redeployCooldown"] as const) {
    if (!isNum(op[k]) || (op[k] as number) <= 0) fail("operators.json", id, `${k} 必须为正数`);
  }
  for (const k of ["def", "res", "blockCount"] as const) {
    if (!isNum(op[k]) || (op[k] as number) < 0) fail("operators.json", id, `${k} 必须为非负数`);
  }
  if (!["physical", "arts"].includes(String(op.damageType))) fail("operators.json", id, "damageType 非法");
  const range = op.range;
  if (!Array.isArray(range) || range.length === 0) {
    fail("operators.json", id, "range 必须为非空数组");
  } else {
    const hasSelf = range.some(c => Array.isArray(c) && c.length === 2 && c[0] === 0 && c[1] === 0);
    if (!hasSelf) fail("operators.json", id, "range 必须包含 [0,0]");
    for (const cell of range) {
      if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(isNum)) fail("operators.json", id, "range 元素必须为 [dr,dc] 数字对");
    }
  }
}

// ---------- enemies.json ----------

const enemies = enemyPacks as Record<string, unknown>[];
const enemyIds = new Set<string>();
for (const en of enemies) {
  const id = String(en.id ?? "(?)");
  checkIdOwner("enemies.json", id, "en");
  enemyIds.add(id);
  for (const k of ["hp", "atk", "attackInterval", "speed"] as const) {
    if (!isNum(en[k]) || (en[k] as number) <= 0) fail("enemies.json", id, `${k} 必须为正数`);
  }
  for (const k of ["def", "res", "blockWeight", "leakDamage"] as const) {
    if (!isNum(en[k]) || (en[k] as number) < 0) fail("enemies.json", id, `${k} 必须为非负数`);
  }
  if (!["physical", "arts"].includes(String(en.damageType))) fail("enemies.json", id, "damageType 非法");
}

// ---------- relics.json ----------

const relics = relicPacks as Record<string, unknown>[];
const relicIds = new Set<string>();
for (const rl of relics) {
  const id = String(rl.id ?? "(?)");
  checkIdOwner("relics.json", id, "rl");
  relicIds.add(id);
  if (!isNum(rl.rarity) || (rl.rarity as number) < 1 || (rl.rarity as number) > 6) fail("relics.json", id, "rarity 必须为 1-6");
  if (!isStr(rl.description)) fail("relics.json", id, "description 必须为非空字符串");
  if (!Array.isArray(rl.mods) || (rl.mods as unknown[]).length === 0) {
    fail("relics.json", id, "mods 必须为非空数组");
  } else {
    (rl.mods as unknown[]).forEach((m, i) => checkMod("relics.json", id, m, i));
  }
}

// ---------- stages.json ----------

const stages = stagePacks as Record<string, unknown>[];
for (const st of stages) {
  const id = String(st.id ?? "(?)");
  checkIdOwner("stages.json", id, "st");
  const rows = st.rows, cols = st.cols;
  if (!isNum(rows) || !isNum(cols) || rows <= 0 || cols <= 0) {
    fail("stages.json", id, "rows/cols 必须为正整数");
    continue;
  }
  const terrain = st.terrain as string[] | undefined;
  if (!Array.isArray(terrain) || terrain.length !== rows) {
    fail("stages.json", id, `terrain 必须为长度 ${rows} 的字符串数组`);
    continue;
  }
  for (let r = 0; r < terrain.length; r++) {
    if (terrain[r].length !== cols) fail("stages.json", id, `terrain[${r}] 长度必须为 ${cols}`);
    for (const ch of terrain[r]) {
      if (!".rh#SG".includes(ch)) fail("stages.json", id, `terrain 含非法字符 "${ch}"`);
    }
  }
  const cellOf = (p: unknown): string | undefined => {
    const pt = p as { row: number; col: number };
    if (!pt || !isNum(pt.row) || !isNum(pt.col)) return undefined;
    if (pt.row < 0 || pt.row >= (rows as number) || pt.col < 0 || pt.col >= (cols as number)) return "越界";
    return terrain[pt.row][pt.col];
  };
  const spawns = st.spawns as { row: number; col: number }[] | undefined;
  const goals = st.goals as { row: number; col: number }[] | undefined;
  if (!Array.isArray(spawns) || spawns.length === 0) fail("stages.json", id, "spawns 必须为非空数组");
  if (!Array.isArray(goals) || goals.length === 0) fail("stages.json", id, "goals 必须为非空数组");
  if (Array.isArray(spawns)) spawns.forEach((p, i) => { if (cellOf(p) !== "S") fail("stages.json", id, `spawns[${i}] 必须位于 S 格`); });
  if (Array.isArray(goals)) goals.forEach((p, i) => { if (cellOf(p) !== "G") fail("stages.json", id, `goals[${i}] 必须位于 G 格`); });
  const paths = st.paths as { row: number; col: number }[][] | undefined;
  if (!Array.isArray(paths)) {
    fail("stages.json", id, "paths 必须为数组");
  } else {
    if (paths.length !== (spawns?.length ?? 0)) fail("stages.json", id, "paths 下标数必须与 spawns 一致");
    paths.forEach((wp, i) => {
      if (!Array.isArray(wp) || wp.length < 2) { fail("stages.json", id, `paths[${i}] 至少需要 2 个路点`); return; }
      if (spawns && (wp[0].row !== spawns[i].row || wp[0].col !== spawns[i].col)) fail("stages.json", id, `paths[${i}] 首点必须等于 spawns[${i}]`);
      if (goals && !goals.some(g => wp[wp.length - 1].row === g.row && wp[wp.length - 1].col === g.col)) {
        fail("stages.json", id, `paths[${i}] 末点必须是某个 goals`);
      }
      for (const p of wp) {
        const c = cellOf(p);
        if (c !== "r" && c !== "S" && c !== "G") fail("stages.json", id, `paths[${i}] 含不可通行格 (${p.row},${p.col})`);
      }
    });
  }
  const waves = st.waves as Record<string, unknown>[] | undefined;
  if (!Array.isArray(waves) || waves.length === 0) {
    fail("stages.json", id, "waves 必须为非空数组");
  } else {
    waves.forEach((w, wi) => {
      if (!["time", "clear"].includes(String(w.trigger))) fail("stages.json", id, `waves[${wi}].trigger 非法`);
      if (!isNum(w.delay) || (w.delay as number) < 0) fail("stages.json", id, `waves[${wi}].delay 必须为非负数`);
      const entries = w.entries as Record<string, unknown>[] | undefined;
      if (!Array.isArray(entries) || entries.length === 0) { fail("stages.json", id, `waves[${wi}].entries 必须为非空数组`); return; }
      entries.forEach((e, ei) => {
        if (!enemyIds.has(String(e.enemyId))) fail("stages.json", id, `waves[${wi}].entries[${ei}].enemyId "${String(e.enemyId)}" 不存在于 enemies.json`);
        if (!isNum(e.count) || (e.count as number) <= 0) fail("stages.json", id, `waves[${wi}].entries[${ei}].count 必须为正数`);
        if (!isNum(e.interval) || (e.interval as number) < 0) fail("stages.json", id, `waves[${wi}].entries[${ei}].interval 非法`);
        if (!isNum(e.delay) || (e.delay as number) < 0) fail("stages.json", id, `waves[${wi}].entries[${ei}].delay 非法`);
        if (!isNum(e.spawn) || (e.spawn as number) < 0 || (e.spawn as number) >= (spawns?.length ?? 0)) {
          fail("stages.json", id, `waves[${wi}].entries[${ei}].spawn 索引越界`);
        }
      });
    });
  }
  for (const k of ["initialDp", "dpRate", "objectiveHp"] as const) {
    if (!isNum(st[k]) || (st[k] as number) <= 0) fail("stages.json", id, `${k} 必须为正数`);
  }
}

// ---------- events.json ----------

const events = eventPacks as Record<string, unknown>[];
for (const ev of events) {
  const id = String(ev.id ?? "(?)");
  checkIdOwner("events.json", id, "ev");
  if (!isStr(ev.title)) fail("events.json", id, "title 必须为非空字符串");
  if (!isStr(ev.text)) fail("events.json", id, "text 必须为非空字符串");
  const options = ev.options as Record<string, unknown>[] | undefined;
  if (!Array.isArray(options) || options.length === 0) {
    fail("events.json", id, "options 必须为非空数组");
    continue;
  }
  options.forEach((o, oi) => {
    if (!isStr(o.text)) fail("events.json", id, `options[${oi}].text 必须为非空字符串`);
    for (const k of ["requireHope", "requireIngots", "requireHp"] as const) {
      if (o[k] !== undefined && (!isNum(o[k]) || (o[k] as number) < 0)) fail("events.json", id, `options[${oi}].${k} 必须为非负数`);
    }
    const effects = o.effects as Record<string, unknown>[] | undefined;
    if (!Array.isArray(effects)) { fail("events.json", id, `options[${oi}].effects 必须为数组`); return; }
    effects.forEach((ef, ei) => {
      const t = `options[${oi}].effects[${ei}]`;
      if (!["hope", "ingots", "hp", "relic", "ticket", "operator"].includes(String(ef.kind))) fail("events.json", id, `${t}.kind 非法`);
      if (!["add", "remove"].includes(String(ef.op))) fail("events.json", id, `${t}.op 非法`);
      if (ef.kind === "hope" || ef.kind === "ingots" || ef.kind === "hp") {
        if (!isNum(ef.value)) fail("events.json", id, `${t} 数值型效果 value 必须为数字`);
      } else {
        if (!isStr(ef.value)) fail("events.json", id, `${t} 引用型效果 value 必须为字符串（可用 "${OP}" 表示随机）`);
        if (ef.kind === "relic" && isStr(ef.value) && ef.value !== OP && !relicIds.has(ef.value)) {
          fail("events.json", id, `${t} 引用的收藏品 "${String(ef.value)}" 不存在`);
        }
      }
    });
  });
}

// ---------- run-config.json ----------

{
  const cfg = runConfig as Record<string, unknown>;
  const rs = cfg.runStart as Record<string, number> | undefined;
  if (!rs) fail("run-config.json", "runStart", "缺失");
  else {
    for (const k of ["hope", "hopeCap", "ingots", "objectiveHp", "objectiveHpCap", "squadSizeBase"] as const) {
      if (!isNum(rs[k]) || rs[k] < 0) fail("run-config.json", `runStart.${k}`, "必须为非负数");
    }
  }
  const floors = cfg.floors as Record<string, unknown>[] | undefined;
  if (!Array.isArray(floors) || floors.length < 3) fail("run-config.json", "floors", "至少需要 3 层");
  else {
    floors.forEach((f, i) => {
      if (!isStr(f.floorName)) fail("run-config.json", `floors[${i}]`, "floorName 必须为非空字符串");
      const r = f.nodeCountRange as number[] | undefined;
      if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum) || r[0] < 2 || r[1] < r[0]) {
        fail("run-config.json", `floors[${i}]`, "nodeCountRange 必须为 [min,max] 且 min>=2");
      }
      const w = f.weights as Record<string, number> | undefined;
      if (!w || Object.keys(w).length === 0) fail("run-config.json", `floors[${i}]`, "weights 必须为非空对象");
      else {
        for (const [k, v] of Object.entries(w)) {
          if (!["battle", "emergencyBattle", "shop", "event", "gift", "safeCorner", "interlude"].includes(k)) {
            fail("run-config.json", `floors[${i}].weights`, `非法节点类型 "${k}"`);
          }
          if (!isNum(v) || v < 0) fail("run-config.json", `floors[${i}].weights`, `"${k}" 权重必须为非负数`);
        }
      }
    });
  }
  const teams = cfg.teams as Record<string, unknown>[] | undefined;
  if (!Array.isArray(teams) || teams.length < 2) fail("run-config.json", "teams", "至少需要 2 个分队");
  else {
    teams.forEach((t, i) => {
      const id = String(t.id ?? `teams[${i}]`);
      if (!id.startsWith("team_")) fail("run-config.json", id, "id 必须以 team_ 开头");
      if (!isStr(t.name) || !isStr(t.description)) fail("run-config.json", id, "name/description 必填");
      if (!Array.isArray(t.mods)) fail("run-config.json", id, "mods 必须为数组");
      else t.mods.forEach((m, mi) => checkMod("run-config.json", id, m, mi));
    });
  }
}

// ---------- 汇总 ----------

if (errors.length > 0) {
  console.error(`\n数据校验失败，共 ${errors.length} 处错误：\n`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
} else {
  console.log(
    `✓ 数据校验全部通过：干员 ${operators.length} | 敌人 ${enemies.length} | 收藏品 ${relics.length} | 关卡 ${stages.length} | 事件 ${events.length}`
  );
  process.exit(0);
}
