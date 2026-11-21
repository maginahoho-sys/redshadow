/**
 * M16 终局回归（headless，一次性脚本）：
 *   Phase A：完整通关一局（5 层 → 探索胜利）
 *   Phase B：中断 → 刷新 → 「继续探索」续档 → 打一场 → 探索失败
 * 全程收集 console/page error。
 *
 * 自动化策略：
 *   - Rogue 界面：运行时直接调私有方法 enterNode/finishPanel（TS private 仅编译期）
 *   - 战斗：registry battleSpeed=6 加速 + __battleApi 驱动的贪心自动部署
 *   - 等待循环：全部在单次 evaluate 内完成（M9 教训：跨 evaluate RAF 节流假死）
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const URL = process.argv[2] || "http://localhost:5173";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const dir = "/Users/zhanghaifeng/.cache/puppeteer/chrome";
  let found = null;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "Google Chrome for Testing" && p.includes("/Contents/MacOS/")) found = p;
    }
  })(dir);
  return found;
}

/** 贪心自动部署（与 sim-balance 同策略，作为函数源码字符串注入页面执行） */
const DEPLOY_SRC = `
  (function (api) {
    return function autoDeploy(state) {
      const stage = state.stage;
      const cells = new Set();
      for (const wp of stage.paths) for (const p of wp) cells.add(p.row + "," + p.col);
      const ranged = [];
      for (let r = 0; r < stage.rows; r++) for (let c = 0; c < stage.cols; c++) {
        if (stage.terrain[r][c] !== "h") continue;
        let cover = 0;
        for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1, 2]) if (cells.has((r + dr) + "," + (c + dc))) cover++;
        ranged.push({ cell: { row: r, col: c }, cover });
      }
      ranged.sort((a, b) => b.cover - a.cover);
      const melee = [];
      for (const wp of stage.paths) for (const f of [0.35, 0.5, 0.65]) melee.push(wp[Math.floor((wp.length - 1) * f)]);
      const order = ["vanguard", "defender", "guard", "specialist"];
      const ready = state.squad.filter(m => m.state === "ready").map(m => m.operatorId);
      const meleeIds = ready.filter(id => state.operatorDefs[id].placement === "melee")
        .sort((a, b) => order.indexOf(state.operatorDefs[a].profession) - order.indexOf(state.operatorDefs[b].profession));
      const rangedIds = ready.filter(id => state.operatorDefs[id].placement === "ranged");
      let deployed = 0;
      for (const id of rangedIds) for (const s of ranged) {
        if (api.canDeploy(state, id, s.cell).ok) { api.deployOperator(state, id, s.cell); deployed++; break; }
      }
      for (const id of meleeIds) for (const cell of melee) {
        if (api.canDeploy(state, id, cell).ok) { api.deployOperator(state, id, cell); deployed++; break; }
      }
      return deployed;
    };
  })
`;

/** 推进一整场战斗：单次 evaluate 内轮询（6 倍速 + 自动部署）→ 点结算按钮 → 等切回 Rogue */
async function runBattle(page, label) {
  const result = await page.evaluate(async (label, deploySrc) => {
    const api = window.__battleApi;
    const autoDeploy = eval(deploySrc)(api);
    const t0 = Date.now();
    const MAX_MS = 300000; // 单场 5 分钟真实时间上限
    let lastLog = "";
    // 先等 Battle 场景激活（scene.start 是下一帧生效）
    while (Date.now() - t0 < 10000 && !window.__game.scene.isActive("Battle")) {
      await new Promise(r => setTimeout(r, 150));
    }
    while (Date.now() - t0 < MAX_MS) {
      const state = api.battle();
      if (!state) { await new Promise(r => setTimeout(r, 300)); continue; }
      if (state.status !== "running") {
        lastLog = `${label} 结束: ${state.status}（游戏内 ${Math.round(state.time)}s，剩生命 ${state.objectiveHp}）`;
        break;
      }
      const n = autoDeploy(state);
      if (n > 0) lastLog = `${label} 部署 +${n}`;
      await new Promise(r => setTimeout(r, 120));
    }
    return { log: lastLog || `${label} 无日志`, timeout: Date.now() - t0 >= MAX_MS };
  }, label, DEPLOY_SRC);

  // 结算面板出现后点「返回节点地图」(640,420)，然后等切回 Rogue
  await sleep(700);
  await page.mouse.click(640, 420);
  const switched = await page.evaluate(async () => {
    const t = Date.now();
    while (Date.now() - t < 15000) {
      if (window.__game.scene.isActive("Rogue")) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    return false;
  });
  result.switched = switched;
  return result;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--mute-audio"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console: " + m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle0" });
  await sleep(1200);

  console.log("=== Phase A：完整通关一局 ===");
  // 1) Boot → 新的探索
  const hasSaveBtn = await page.evaluate(() => window.__game.scene.isActive("Boot"));
  if (hasSaveBtn) {
    await page.mouse.click(640, 500);
    await sleep(600);
  }
  // 2) 分队选择 → 第一张卡
  await page.mouse.click(505, 340);
  await sleep(800);

  // 3) 增强编队（8 人 + 4 收藏品）确保能通 5 层
  const boosted = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue.run;
    if (!run) return false;
    run.squad = ["op_vanguard_01", "op_defender_01", "op_guard_01", "op_specialist_01",
      "op_sniper_01", "op_caster_01", "op_medic_01", "op_supporter_01"];
    // 5 层通关的成熟 build：回费/初始费用/敌人三件套/生存/攻速
    run.relics = ["rl_wine_cup", "rl_candle_stub", "rl_dull_mask", "rl_hourglass",
      "rl_red_gauze", "rl_old_script"];
    run.objectiveHp = 8;
    return true;
  });
  if (!boosted) { console.log("✗ 编队注入失败（Rogue 未激活）"); await browser.close(); process.exit(1); }

  // 4) 循环推进至终局
  let phaseAResult = "未结束";
  let steps = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 720000) {
    const step = await page.evaluate(async () => {
      const g = window.__game;
      if (g.scene.isActive("Rogue")) {
        const rogue = g.scene.getScene("Rogue");
        const run = rogue.run;
        if (!run) return { act: "teamSelect" };
        if (run.objectiveHp <= 0) return { act: "ending", won: false };
        if (run.eventLog.some(l => l.includes("runComplete:win"))) return { act: "ending", won: true };
        const map = run.nodeMap;
        const enterable = run.currentNodeId === null ? [map.start] : map.nodes[run.currentNodeId].next;
        const nid = enterable[0];
        const node = map.nodes[nid];
        if (!node) return { act: "stuck", detail: `无 enterable 节点（current=${run.currentNodeId}）` };
        rogue.pendingNodeId = nid;
        if (["battle", "emergencyBattle", "boss"].includes(node.type)) {
          rogue.enterNode(nid);
          return { act: "battle", type: node.type, floor: run.floor };
        }
        rogue.enterNode(nid);
        await new Promise(r => setTimeout(r, 150));
        rogue.finishPanel();
        return { act: "panel", type: node.type, floor: run.floor };
      }
      return { act: "idle" };
    });

    steps++;
    if (step.act === "ending") { phaseAResult = step.won ? "胜利" : "失败"; break; }
    if (step.act === "stuck") { phaseAResult = "卡死:" + step.detail; break; }
    if (step.act === "battle") {
      // 设置倍速再跑完
      await page.evaluate(() => {
        const g = window.__game;
        g.registry.set("battleSpeed", 4);
        g.registry.set("battlePaused", false);
      });
      const r = await runBattle(page, `F${step.floor} ${step.type}`);
      console.log(`  F${step.floor} ${step.type} → ${r.log}${r.switched ? "" : " [未切回]"}${r.timeout ? " [超时]" : ""}`);
      if (r.timeout || !r.switched) { phaseAResult = "战斗异常"; break; }
      // 下一循环前小睡
      await sleep(400);
    } else if (step.act === "panel") {
      // console.log(`  F${step.floor} ${step.type} 面板完成`);
    } else if (step.act === "teamSelect" || step.act === "idle") {
      await sleep(500);
    }
    await sleep(150);
  }
  console.log(`Phase A 结果：${phaseAResult}（${steps} 步，${Math.round((Date.now() - t0) / 1000)}s）`);
  const phaseAOK = phaseAResult === "胜利";

  console.log("=== Phase B：中断 → 刷新续档 → 失败一局 ===");
  // 清档开新局
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1200);
  await page.mouse.click(640, 500);   // 新的探索（Boot）
  await sleep(600);
  await page.mouse.click(505, 340);   // 分队
  await sleep(800);

  // 弱化：保持空编队（战斗自动补 3 人）+ 生命压到 1，并立即落盘
  const weakened = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue.run;
    if (!run) return false;
    run.objectiveHp = 1;
    run.relics = [];
    window.__battleApi.saveRun(run);   // 调试口落盘，确保续档拿到 hp=1
    return true;
  });
  if (!weakened) { console.log("✗ 弱化注入失败"); await browser.close(); process.exit(1); }

  // 完成一个非战斗节点（若首个 enterable 是面板类）再中断
  const pre = await page.evaluate(async () => {
    const rogue = window.__game.scene.getScene("Rogue");
    const run = rogue.run;
    const map = run.nodeMap;
    const enterable = run.currentNodeId === null ? [map.start] : map.nodes[run.currentNodeId].next;
    const node = map.nodes[enterable[0]];
    const type = node.type;
    if (!["battle", "emergencyBattle", "boss"].includes(type)) {
      rogue.enterNode(node.id);
      await new Promise(r => setTimeout(r, 150));
      rogue.finishPanel();
      return { type, visited: run.visitedNodeIds.length };
    }
    return { type, visited: run.visitedNodeIds.length };
  });
  console.log(`  中断前状态：进入 ${pre.type}，已访问 ${pre.visited} 节点`);

  // 刷新 → 继续探索
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1200);
  const boot2 = await page.evaluate(() => window.__game.scene.isActive("Boot"));
  if (!boot2) console.log("  ✗ 刷新后未回 Boot");
  await page.mouse.click(640, 470);   // 继续探索
  await sleep(800);
  const resumed = await page.evaluate(() => {
    const rogue = window.__game.scene.getScene("Rogue");
    return rogue && rogue.run ? { floor: rogue.run.floor, hp: rogue.run.objectiveHp, visited: rogue.run.visitedNodeIds.length } : null;
  });
  console.log(`  续档恢复：${resumed ? `第 ${resumed.floor} 层 生命${resumed.hp} 已访问${resumed.visited}` : "失败"}`);
  const resumeOK = !!resumed && resumed.hp === 1;

  // 推进到一场战斗 → 不部署 → 敗 → 探索失败
  let phaseBResult = "未结束";
  const t1 = Date.now();
  while (Date.now() - t1 < 240000) {
    const step = await page.evaluate(async () => {
      const g = window.__game;
      if (g.scene.isActive("Rogue")) {
        const rogue = g.scene.getScene("Rogue");
        const run = rogue.run;
        if (!run) return { act: "teamSelect" };
        if (run.objectiveHp <= 0) return { act: "ending", won: false };
        const map = run.nodeMap;
        const enterable = run.currentNodeId === null ? [map.start] : map.nodes[run.currentNodeId].next;
        const node = map.nodes[enterable[0]];
        if (["battle", "emergencyBattle", "boss"].includes(node.type)) {
          rogue.enterNode(node.id);
          return { act: "battle", type: node.type };
        }
        rogue.enterNode(node.id);
        await new Promise(r => setTimeout(r, 150));
        rogue.finishPanel();
        return { act: "panel", type: node.type };
      }
      return { act: "idle" };
    });
    if (step.act === "ending") { phaseBResult = "探索失败结算 ✓"; break; }
    if (step.act === "battle") {
      await page.evaluate(() => {
        window.__game.registry.set("battleSpeed", 4);
        window.__game.registry.set("battlePaused", false);
      });
      // 不部署：等战斗自然结束（漏怪扣生命 → 探索生命归零）
      const r = await page.evaluate(async () => {
        const api = window.__battleApi;
        const g = window.__game;
        const t0 = Date.now();
        // 先等 Battle 激活（场景切换下一帧生效）
        while (Date.now() - t0 < 10000 && !g.scene.isActive("Battle")) {
          await new Promise(r => setTimeout(r, 150));
        }
        while (Date.now() - t0 < 180000) {
          const st = api.battle();
          if (st && st.status !== "running") return st.status;
          await new Promise(r => setTimeout(r, 300));
        }
        return "timeout";
      });
      console.log(`  战斗（不部署干员）：${r}`);
      // 点结算按钮 → 等 Rogue（lost → objectiveHp 0 → 探索失败结算）
      await sleep(700);
      await page.mouse.click(640, 420);
      const end = await page.evaluate(async () => {
        const g = window.__game;
        for (let i = 0; i < 80; i++) {
          if (g.scene.isActive("Rogue")) {
            const rogue = g.scene.getScene("Rogue");
            if (rogue.run && rogue.run.objectiveHp <= 0) return "ending";
            return "map";
          }
          await new Promise(r => setTimeout(r, 300));
        }
        return "none";
      });
      if (end === "ending") { phaseBResult = "探索失败结算 ✓"; break; }
    } else {
      await sleep(300);
    }
  }
  console.log(`Phase B 结果：${phaseBResult}`);
  const phaseBOK = phaseBResult.includes("✓");

  console.log("\n控制台/页面错误：", errors.length === 0 ? "无 ✓" : errors.join("\n"));
  await browser.close();
  const ok = phaseAOK && phaseBOK && resumeOK && errors.length === 0;
  console.log(ok ? "\n✓ M16 终局回归全部通过" : "\n✗ M16 终局回归未全过");
  process.exit(ok ? 0 : 1);
})();
