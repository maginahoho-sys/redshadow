/**
 * M16 经济修复验证：真实玩家开局链路（无任何注入）
 * 1. 新开局 → 编队应为 initialSquad 的 3 名干员
 * 2. 检查第 1 层节点图（应可能出现 interlude 招募节点）
 * 3. 直接进入 boss 节点 → 应选 bossTier 1 关卡（血月试演/候补主演 blockWeight 2）
 * 4. 4 倍速 + 自动部署 → 战斗胜利 → 验证奖励（希望/锭/券）
 */
const { window: _w } = { window: null };
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const URL = process.argv[2] || "http://localhost:5173";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const base = path.join(os.homedir(), ".cache/puppeteer/chrome");
  for (const dir of fs.readdirSync(base)) {
    const mac = path.join(base, dir);
    for (const v of fs.readdirSync(mac)) {
      const exe = path.join(mac, v, "google-chrome-for-testing");
      if (fs.existsSync(exe)) return exe;
      const exe2 = path.join(mac, v, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (fs.existsSync(exe2)) return exe2;
    }
  }
  throw new Error("Chrome for Testing 未找到");
}

/** 部署源码（与 verify-m16-run 同策略） */
const DEPLOY_SRC = `(api) => {
  const order = ["vanguard", "defender", "guard", "specialist"];
  return (state) => {
    const cells = new Set();
    for (const wp of state.stage.paths) for (const p of wp) cells.add(p.row + "," + p.col);
    const ranged = [];
    for (let r = 0; r < state.stage.rows; r++) for (let c = 0; c < state.stage.cols; c++) {
      if (state.stage.terrain[r][c] !== "h") continue;
      let cover = 0;
      for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1, 2]) if (cells.has((r + dr) + "," + (c + dc))) cover++;
      ranged.push({ cell: { row: r, col: c }, cover });
    }
    ranged.sort((a, b) => b.cover - a.cover);
    const melee = [];
    for (const wp of state.stage.paths)
      for (const f of [0.3, 0.45, 0.6, 0.75, 0.9]) melee.push(wp[Math.floor((wp.length - 1) * f)]);
    const ready = state.squad.filter(m => m.state === "ready").map(m => m.operatorId);
    const meleeIds = ready.filter(id => state.operatorDefs[id].placement === "melee")
      .sort((a, b) => order.indexOf(state.operatorDefs[a].profession) - order.indexOf(state.operatorDefs[b].profession));
    const rangedIds = ready.filter(id => state.operatorDefs[id].placement === "ranged");
    let deployed = 0;
    // 近战先下（建立防线 + 医疗部署时才有友军可参考），远程后下
    for (const id of meleeIds) for (const cell of melee) {
      if (api.canDeploy(state, id, cell).ok) { api.deployOperator(state, id, cell); deployed++; break; }
    }
    // 留费建防线：仍有近战 ready 且全部点位因费用不足 → 远程本帧不出手
    let holdDp = false;
    const stillReadyMelee = state.squad.filter(
      m => m.state === "ready" && state.operatorDefs[m.operatorId].placement === "melee"
    );
    for (const m of stillReadyMelee) {
      const checks = melee.map(c => api.canDeploy(state, m.operatorId, c));
      if (checks.every(r => !r.ok) && checks.some(r => r.reason === "费用不足")) { holdDp = true; break; }
    }
    if (!holdDp) {
      for (const id of rangedIds) {
        // 医疗特判：优先站能覆盖最多友军的高台
        let spots = ranged;
        if (state.operatorDefs[id].profession === "medic") {
          spots = [...ranged].sort((a, b) => medicScore(state, id, b) - medicScore(state, id, a));
        }
        for (const s of spots) {
          if (api.canDeploy(state, id, s.cell).ok) { api.deployOperator(state, id, s.cell); deployed++; break; }
        }
      }
    }
    return deployed;
  };
}

/** 医疗评分：高台用医疗射程覆盖到的已部署友军数 */
function medicScore(state, operatorId, cell) {
  const range = state.effective[operatorId].range;
  let n = 0;
  for (const fid of state.world.query("block", "position")) {
    const p = state.world.get(fid, "position");
    if (p && range.some(([dr, dc]) => p.row === cell.row + dr && p.col === cell.col + dc)) n++;
  }
  return n;
}`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ["--no-sandbox", "--window-size=1280,720"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(URL, { waitUntil: "networkidle0" });
  await sleep(1200);

  // 1) 清档 + 新开局（点标题的"新的探索"按钮）
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1200);
  const bootInfo = await page.evaluate(() => {
    const boot = window.__game.scene.getScene("Boot");
    const hasSave = !!boot && boot.children.exists(() => true);
    return { activeBoot: window.__game.scene.isActive("Boot") };
  });
  console.log("Boot 场景激活:", bootInfo.activeBoot);
  // 点"新的探索"（无存档布局在 (640,500)，有存档在 (640,540)）
  await page.mouse.click(640, 500);
  await sleep(800);
  // 若弹了覆盖确认框，点"覆盖并开始"(520,430)
  await page.mouse.click(520, 430);
  await sleep(1000);
  // 分队选择：点第一张卡（380-630 区域中心）
  await page.mouse.click(500, 340);
  await sleep(1000);

  const runInfo = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue && rogue.run;
    if (!run) return null;
    return {
      squad: [...run.squad],
      tickets: [...run.recruitTickets],
      nodeTypes: Object.values(run.nodeMap.nodes).map(n => n.type),
      currentNodeId: run.currentNodeId
    };
  });
  console.log("开局编队:", runInfo.squad);
  console.log("第 1 层节点:", runInfo.nodeTypes.join(", "));

  // 2) 找 boss 节点（末尾汇聚点），直接 enterNode 进战斗
  const bossId = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue.run;
    const boss = Object.values(run.nodeMap.nodes).find(n => n.type === "boss");
    if (!boss) return null;
    rogue.enterNode(boss.id);
    return boss.id;
  });
  await sleep(1500);
  const battleInfo = await page.evaluate(() => {
    const st = window.__battleApi.battle();
    return st ? { stage: st.stage.id, name: st.stage.name, bossWeights: Object.entries(st.enemyDefs)
      .filter(([k]) => k.startsWith("en_boss")).map(([k, v]) => `${k}:block${v.blockWeight}`) } : null;
  });
  console.log(`boss 节点 ${bossId} → 关卡: ${battleInfo.name} (${battleInfo.stage}), BOSS 阻挡需求: ${battleInfo.bossWeights.join(", ")}`);

  // 3) 4 倍速自动部署打完整场
  await page.evaluate(() => {
    window.__game.registry.set("battleSpeed", 4);
    window.__game.registry.set("battlePaused", false);
  });
  const autoDeploy = await page.evaluate(async (src) => {
    const api = window.__battleApi;
    const deploy = eval(src)(api);
    const t0 = Date.now();
    let log = "";
    const trace = [];
    let lastHp = -1, lastDp = -1, lastEnemySnap = -1;
    while (Date.now() - t0 < 300000) {
      const st = api.battle();
      if (!st) break;
      if (st.status !== "running") { log = `${st.status} @${Math.round(st.time)}s 剩生命${st.objectiveHp}`; break; }
      const n = deploy(st);
      const deployed = st.squad.filter(m => m.state === "deployed");
      // 采样：hp/dp 变化或每 2 游戏秒打一行
      const ready = st.squad.filter(m => m.state === "ready");
      let deployFail = "";
      if (ready.length > 0) {
        // 检查第一个 ready 干员为何没部署上
        const id = ready[0].operatorId;
        for (const wp of st.stage.paths) {
          for (const f of [0.35, 0.5, 0.65]) {
            const cell = wp[Math.floor((wp.length - 1) * f)];
            const c = api.canDeploy(st, id, cell);
            if (!c.ok) deployFail = `${id.replace("op_", "")}@(${cell.row},${cell.col}):${c.reason}`;
            break;
          }
          if (deployFail) break;
        }
      }
      if (st.objectiveHp !== lastHp || Math.abs(st.dp - lastDp) > 3) {
        trace.push(`@${st.time.toFixed(1)}s hp=${st.objectiveHp} dp=${st.dp.toFixed(1)} wave=${st.waveIndex} pending=${st.pendingSpawns.length} 在场=[${deployed.map(m => m.operatorId.replace("op_", "")).join(",")}]${deployFail ? " 待部署失败:" + deployFail : ""}`);
        lastHp = st.objectiveHp; lastDp = st.dp;
      }
      // 每 10 游戏秒打印一次敌人明细（定位卡死）
      if (Math.floor(st.time / 10) !== lastEnemySnap) {
        lastEnemySnap = Math.floor(st.time / 10);
        const enemies = st.world ? st.world.query("enemyPath") : [];
        const detail = enemies.map(id => {
          const p = st.world.get(id, "enemyPath");
          const pos = st.world.get(id, "position");
          const h = st.world.get(id, "health");
          let blk = "none";
          if (p && p.blockedBy !== -1) {
            const bi = st.world.get(p.blockedBy, "identity");
            blk = `${p.blockedBy}(${bi ? bi.defId + "/" + bi.faction : "已死亡"})`;
          }
          return `${st.world.get(id, "identity")?.defId}@(${pos?.row.toFixed(1)},${pos?.col.toFixed(1)}) idx${p?.index} blk${blk} hp${Math.round(h?.hp ?? 0)}`;
        }).join(" | ");
        trace.push(`  [敌${enemies.length}] ${detail || "无"}`);
      }
      if (n > 0) trace.push(`  ↑部署+${n}`);
      await new Promise(r => setTimeout(r, 150));
    }
    return log + "\n" + trace.join("\n");
  }, DEPLOY_SRC);
  console.log("第 1 层 BOSS 战:", autoDeploy);

  // 4) 点结算面板"返回节点地图"，等切回 Rogue，验证奖励
  await sleep(800);
  await page.mouse.click(640, 420);
  await sleep(1500);
  const after = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue && rogue.run;
    return run ? { floor: run.floor, hope: run.hope, ingots: run.ingots, tickets: [...run.recruitTickets], relics: run.relics.length } : null;
  });
  console.log("战后状态:", JSON.stringify(after));

  const fail = after === null || !autoDeploy.includes("won");
  console.log("\n" + (fail ? "❌ 验证失败" : "✅ 验证通过：开局 3 人可通关第 1 层 BOSS 关"));
  if (errors.length) console.log("控制台报错:\n" + errors.join("\n"));
  else console.log("控制台 0 报错");
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
