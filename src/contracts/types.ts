/**
 * types.ts —— RedShadow 全量领域类型定义（合同层核心）
 *
 * 【冻结约定】本文件由 P0 一次性产出后冻结。
 * 所有模块只能 import 本文件取类型，禁止修改本文件。
 * 若确需扩展字段：只允许新增"可选字段"，不允许修改/删除已有字段。
 *
 * 命名约定：
 *   - 数据定义（JSON 里的静态内容）后缀 Def：OperatorDef / EnemyDef / RelicDef / StageDef / EventDef
 *   - ECS 组件前缀 C：CIdentity / CPosition / ...
 *   - id 前缀：干员 op_ 敌人 en_ 收藏品 rl_ 关卡 st_ 事件 ev_ 分队 team_
 */

// ============================================================
// 通用基础类型
// ============================================================

/** 网格坐标（row 行向下增长，col 列向右增长，从 0 开始） */
export interface Vec2 {
  readonly row: number;
  readonly col: number;
}

/** 阵营 */
export type Faction = "operator" | "enemy";

/** 伤害类型 */
export type DamageType = "physical" | "arts";

/** 干员职业（八职业） */
export type Profession =
  | "vanguard"   // 先锋
  | "guard"      // 近卫
  | "defender"   // 重装
  | "sniper"     // 狙击
  | "caster"     // 术师
  | "medic"      // 医疗
  | "supporter"  // 辅助
  | "specialist"; // 特种

/** 干员稀有度（初始内容用 3~6） */
export type Rarity = 1 | 2 | 3 | 4 | 5 | 6;

/** 放置类型：近战站地面道路，远程站高台 */
export type PlacementType = "melee" | "ranged";

/**
 * 地形编码（关卡 JSON 中 terrain 每行的字符）：
 *   '.' 空 | 'r' 地面道路（可部署近战，敌人可通行）
 *   'h' 高台（可部署远程） | '#' 墙（不可通行不可部署）
 *   'S' 敌人出生点 | 'G' 防御点（敌人到达则扣目标生命）
 */
export type TerrainCode = "." | "r" | "h" | "#" | "S" | "G";

// ============================================================
// 数据定义层（JSON 内容，见 src/data/）
// ============================================================

/** 干员静态定义 */
export interface OperatorDef {
  readonly id: string;            // op_xxx
  readonly name: string;
  readonly profession: Profession;
  readonly rarity: Rarity;
  readonly placement: PlacementType;
  readonly cost: number;          // 部署费用
  readonly blockCount: number;    // 阻挡数
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly res: number;           // 法术抗性 0~100（百分比）
  readonly attackInterval: number; // 攻击间隔（秒）
  readonly damageType: DamageType;
  /** 攻击范围：相对自身格的偏移数组 [[dr,dc],...]，必须包含 [0,0]（近战为当前格） */
  readonly range: ReadonlyArray<readonly [number, number]>;
  readonly redeployCooldown: number; // 撤退后再部署冷却（秒）
  /** 部署期间使我方费用回复速率提升（先锋用，点/秒，可选） */
  readonly dpBonusRate?: number;
  /** 标签：供收藏品词条选择器匹配，如 ["ranged","vanguard"] */
  readonly tags?: ReadonlyArray<string>;
  readonly description?: string;
}

/** 敌人静态定义 */
export interface EnemyDef {
  readonly id: string;            // en_xxx
  readonly name: string;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly res: number;
  readonly attackInterval: number; // 攻击间隔（秒）
  readonly damageType: DamageType;
  readonly speed: number;        // 移动速度（格/秒）
  readonly blockWeight: number;  // 占用的阻挡位（通常 1）
  readonly leakDamage: number;   // 进入防御点扣的目标生命
  readonly tags?: ReadonlyArray<string>;
}

/** 实体选择器：声明式描述词条作用对象 */
export interface EntitySelector {
  /** 只匹配某阵营；缺省 = 双方 */
  readonly faction?: Faction;
  /** 只匹配这些职业（仅干员有效） */
  readonly professions?: ReadonlyArray<Profession>;
  /** 必须同时持有所有标签 */
  readonly tagsAll?: ReadonlyArray<string>;
  /** 持有任一标签即匹配 */
  readonly tagsAny?: ReadonlyArray<string>;
}

/** 可被词条修改的统计键 */
export type StatKey =
  | "hp" | "atk" | "def" | "res" | "cost" | "attackInterval"
  | "blockCount" | "speed" | "redeployCooldown";

/** 战斗全局参数键（非实体属性） */
export type GlobalKey = "dpRate" | "initialDp" | "objectiveHp" | "tempObjectiveHp" | "squadSize";

/** 探索局属性键（肉鸽层货币/资源） */
export type RunStatKey = "hope" | "ingots" | "objectiveHp" | "hopeCap";

/**
 * 收藏品/分队词条 —— 全项目的可扩展性核心。
 * 新增千种收藏品 = 新增千份 RelicDef JSON，逻辑零改动。
 */
export type RelicMod =
  /** 修改选中实体的某项属性 */
  | {
      readonly kind: "stat";
      readonly selector: EntitySelector;
      readonly stat: StatKey;
      readonly op: "add" | "mul";  // 先汇总所有 add，再汇总所有 mul
      readonly value: number;
    }
  /** 修改战斗全局参数 */
  | {
      readonly kind: "global";
      readonly target: GlobalKey;
      readonly op: "add" | "mul";
      readonly value: number;
    }
  /** 给选中实体附加标签（供其他词条/逻辑匹配） */
  | {
      readonly kind: "grantTag";
      readonly selector: EntitySelector;
      readonly tag: string;
    }
  /** 修改探索局初始资源（分队用） */
  | {
      readonly kind: "runStat";
      readonly target: RunStatKey;
      readonly op: "add" | "mul";
      readonly value: number;
    };

/** 收藏品静态定义 */
export interface RelicDef {
  readonly id: string;           // rl_xxx
  readonly name: string;
  readonly rarity: Rarity;
  readonly description: string;
  readonly mods: ReadonlyArray<RelicMod>;
}

/** 出怪条目 */
export interface WaveEntry {
  readonly enemyId: string;
  readonly count: number;        // 数量
  readonly interval: number;     // 出怪间隔（秒）
  readonly delay: number;        // 相对本波开始的首个延迟（秒）
  readonly spawn: number;        // 出生点索引（对应 stage.spawns）
}

/** 一波敌人 */
export interface Wave {
  /** 'time'：上一波开始后 delay 秒触发；'clear'：场上敌人清空后 delay 秒触发 */
  readonly trigger: "time" | "clear";
  readonly delay: number;
  readonly entries: ReadonlyArray<WaveEntry>;
}

/** 关卡静态定义 */
export interface StageDef {
  readonly id: string;           // st_xxx
  readonly name: string;
  readonly rows: number;
  readonly cols: number;
  /** 地形，每行一个字符串，长度必须等于 cols */
  readonly terrain: ReadonlyArray<string>;
  /** 出生点（与 paths 下标对应） */
  readonly spawns: ReadonlyArray<Vec2>;
  /** 防御点 */
  readonly goals: ReadonlyArray<Vec2>;
  /** 敌人行进路点（与 spawns 下标对应；首点=出生点，末点=防御点） */
  readonly paths: ReadonlyArray<ReadonlyArray<Vec2>>;
  readonly waves: ReadonlyArray<Wave>;
  readonly initialDp: number;
  readonly dpRate: number;       // 费用自然回复（点/秒）
  readonly objectiveHp: number;  // 本关目标生命（漏怪扣除，归零判负）
  readonly isBossStage?: boolean;
}

/** 探索事件效果（事件/商店共用） */
export interface EventEffect {
  readonly kind: "hope" | "ingots" | "hp" | "relic" | "ticket" | "operator";
  readonly op: "add" | "remove";
  /** hope/ingots/hp 为数值；relic/ticket/operator 为 id 字符串（op:add 时 value 必填） */
  readonly value?: number | string;
}

/** 事件选项 */
export interface EventOption {
  readonly text: string;
  /** 前置条件（不满足则选项置灰） */
  readonly requireHope?: number;
  readonly requireIngots?: number;
  readonly requireHp?: number;
  readonly effects: ReadonlyArray<EventEffect>;
}

/** 探索事件静态定义 */
export interface EventDef {
  readonly id: string;           // ev_xxx
  readonly title: string;
  readonly text: string;
  readonly options: ReadonlyArray<EventOption>;
}

/** 商店条目 */
export interface ShopItem {
  readonly id: string;            // 唯一实例 id
  readonly kind: "relic" | "ticket" | "promotion" | "life" | "operator";
  readonly payloadId: string;    // 对应 rl_/职业名/operatorId；promotion 为干员 id
  readonly cost: number;          // 源石锭价格
  readonly sold?: boolean;
}

/** 分队定义（开局修饰器） */
export interface TeamDef {
  readonly id: string;            // team_xxx
  readonly name: string;
  readonly description: string;
  readonly mods: ReadonlyArray<RelicMod>;
}

// ============================================================
// ECS 组件（实现见 contracts/ecs.ts，字段可变，供系统原地读写）
// ============================================================

/** 组件键名（world.add / world.query 使用） */
export type ComponentKey =
  | "identity" | "position" | "health" | "attack"
  | "block" | "enemyPath" | "tags";

export interface CIdentity {
  defId: string;      // OperatorDef.id 或 EnemyDef.id
  faction: Faction;
  name: string;
}

/** 连续坐标（格为单位，干员恒为整数格，敌人为浮点） */
export interface CPosition {
  row: number;
  col: number;
}

export interface CHealth {
  hp: number;
  maxHp: number;
}

export interface CAttack {
  atk: number;
  def: number;
  res: number;
  damageType: DamageType;
  interval: number;    // 攻击间隔
  timer: number;       // 攻击计时器，累积到 interval 发动一次攻击后清零
  targetLimit: number; // 单次攻击目标数（默认 1）
}

/** 阻挡组件（挂在干员实体上） */
export interface CBlock {
  capacity: number;       // 阻挡上限
  blocked: number[];      // 被阻挡的敌人实体 id 列表
}

/** 敌人行进组件 */
export interface CEnemyPath {
  waypoints: Vec2[];     // 行进路点
  index: number;          // 当前目标路点下标
  speed: number;          // 格/秒
  blockedBy: number;     // 阻挡者实体 id，-1 = 未被阻挡
  blockWeight: number;
  leakDamage: number;
}

/** 标签组件（词条 grantTag 写入；选择器查询用） */
export interface CTags {
  tags: string[];
}

/** 组件键 → 组件数据 的映射（ECS add/get 的类型依据） */
export interface ComponentMap {
  identity: CIdentity;
  position: CPosition;
  health: CHealth;
  attack: CAttack;
  block: CBlock;
  enemyPath: CEnemyPath;
  tags: CTags;
}

// ============================================================
// 运行时状态
// ============================================================

/** 队伍成员状态（战斗内） */
export interface SquadMember {
  operatorId: string;        // OperatorDef.id
  state: "ready" | "deployed" | "cooldown";
  cooldownRemaining: number; // state==='cooldown' 时的剩余秒数
  entityId?: number;         // state==='deployed' 时的实体 id
}

/**
 * 词条结算产物：每名干员的有效属性（M4 生成，M3 部署时使用）。
 * 战斗开始时按当前收藏品/分队一次性求值，战斗中不再变化。
 */
export interface EffectiveStats {
  cost: number;
  hp: number;
  atk: number;
  def: number;
  res: number;
  attackInterval: number;
  blockCount: number;
  damageType: DamageType;
  range: ReadonlyArray<readonly [number, number]>;
  redeployCooldown: number;
  dpBonusRate: number;
  tags: string[];
}

/** 词条结算产物的战斗全局参数 */
export interface EffectiveGlobals {
  dpRate: number;
  initialDp: number;
  objectiveHp: number;
  tempObjectiveHp: number;
  squadSize: number;
}

export type BattleStatus = "running" | "won" | "lost";

/** 待出生敌人（M5 波次调度器维护，按 at 升序） */
export interface PendingSpawn {
  enemyId: string;
  spawnIndex: number;
  at: number; // 绝对战斗时间（秒）
}

/**
 * 战斗运行时状态 —— 各逻辑系统的统一上下文。
 * 由战斗创建器组装（M16 整合时实现 createBattle），逻辑系统只读写本状态。
 */
export interface BattleState {
  stage: StageDef;
  world: import("./ecs").World;
  bus: import("./events").EventBus<GameEvent>;
  rng: import("./rng").Rng;
  /** 注册表：本战斗可用的数据定义（按 id 索引） */
  operatorDefs: Record<string, OperatorDef>;
  enemyDefs: Record<string, EnemyDef>;
  /** 战斗时间（秒），由主循环累加 */
  time: number;
  /** 当前费用 */
  dp: number;
  /** 目标生命（本关内漏怪扣除；<=0 判负） */
  objectiveHp: number;
  /** 临时目标生命（分队的 tempObjectiveHp 词条注入，本关有效，不回落） */
  tempObjectiveHp: number;
  squad: SquadMember[];
  /** 词条结算后的每名干员有效属性（M4 产出） */
  effective: Record<string, EffectiveStats>;
  /** 词条结算后的全局参数（M4 产出） */
  globals: EffectiveGlobals;
  status: BattleStatus;
  /** M5 波次进度 */
  waveIndex: number;        // 已开始的波数（0 表示尚未开始第一波）
  waveTimer: number;        // 当前波开始后经过的秒数
  pendingSpawns: PendingSpawn[];
  currentWaveAllSpawned: boolean;
}

// ============================================================
// 游戏事件（EventBus 载荷；渲染层订阅这些事件驱动表现）
// ============================================================

export type GameEvent =
  | { type: "enemySpawned"; entityId: number; defId: string; spawnIndex: number }
  | { type: "operatorDeployed"; entityId: number; operatorId: string; at: Vec2 }
  | { type: "operatorRetreated"; operatorId: string }
  | { type: "attackLanded"; attacker: number; target: number; damage: number; damageType: DamageType }
  | { type: "entityDied"; entityId: number; faction: Faction }
  | { type: "enemyBlocked"; enemyId: number; blockerId: number }
  | { type: "enemyLeaked"; entityId: number; leakDamage: number }
  | { type: "waveStarted"; index: number }
  | { type: "dpChanged"; dp: number }
  | { type: "battleEnded"; result: "won" | "lost" };

export type GameEventType = GameEvent["type"];

// ============================================================
// 肉鸽探索层（M6/M7/M11 使用）
// ============================================================

/** 节点类型（先实现前 5 种，gift/safeCorner/interlude 数据驱动预留） */
export type NodeType =
  | "battle"          // 作战
  | "emergencyBattle" // 紧急作战
  | "shop"            // 诡意行商
  | "event"           // 不期而遇
  | "boss"            // 险路恶敌
  | "gift"            // 古堡馈赠（预留）
  | "safeCorner"      // 安全的角落（预留）
  | "interlude";      // 幕间余兴（预留）

/** 单层节点图中的一个节点 */
export interface MapNode {
  readonly id: string;        // n<floor>_<index>
  readonly type: NodeType;
  /** 渲染用坐标（M11 节点图界面按此摆放） */
  readonly row: number;
  readonly col: number;
  readonly next: ReadonlyArray<string>; // 后继节点 id
}

/** 一层（一个区域）的节点图：有向无环，start 到 boss 必达 */
export interface NodeMap {
  readonly floor: number;      // 层号 1..5
  readonly floorName: string;
  readonly nodes: Readonly<Record<string, MapNode>>;
  readonly start: string;      // 入口节点 id
  readonly boss: string;       // 本层 boss 节点 id
}

export type NodeSelection =
  | { kind: "operator"; operatorId: string }  // 招募结果带干员
  | { kind: "none" };

/** 探索局状态（跨关卡持续，M6/M7 维护，M11 展示） */
export interface RunState {
  seed: number;
  teamId: string;               // team_xxx
  floor: number;                // 当前层 1..5
  nodeMap: NodeMap;             // 当前层节点图
  currentNodeId: string | null; // null = 尚未进入任何节点（处于 start 前的分叉选择）
  visitedNodeIds: string[];
  hope: number;
  hopeCap: number;
  ingots: number;               // 源石锭
  objectiveHp: number;
  objectiveHpCap: number;
  squad: string[];              // 可上阵干员 op_xxx 列表
  reserve: string[];            // 编队溢出的后备干员
  promoted: Record<string, boolean>; // 干员 id → 是否进阶（进阶后属性上浮）
  relics: string[];             // rl_xxx 列表
  recruitTickets: string[];     // 职业招募券（存职业名，"high" 表示高级招募）
  recruitPools: Record<string, string[]>; // 每张券对应的可选干员 id 候选
  eventLog: string[];
}
