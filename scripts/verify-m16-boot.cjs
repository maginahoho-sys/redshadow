/**
 * M16 场景串联 + 存档 headless 验证（一次性脚本，不进测试套件）
 * 验证：Boot 标题 → 新的探索 → 分队选择 → 存档写入 → 刷新 → 继续探索。
 * 注意：RAF 节流坑——轮询与断言必须在单次 evaluate 内完成。
 */
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = "/Users/zhanghaifeng/.cache/puppeteer/chrome/mac_arm-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const URL = process.argv[2] || "http://localhost:5173";

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { globSync } = await import("node:fs").then(() => require("node:fs"));
  // glob 手动展开（Chrome 路径含空格与通配符）
  const fs = require("fs");
  const dir = "/Users/zhanghaifeng/.cache/puppeteer/chrome";
  let chromePath = null;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "Google Chrome for Testing" && p.includes("/Contents/MacOS/")) chromePath = p;
    }
  })(dir);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--mute-audio"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(URL, { waitUntil: "networkidle0" });
  await sleep(1500);

  // ---- 1. 标题画面 ----
  const boot = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const hasText = s => !![...document.querySelectorAll("canvas")].length &&
      window.__game.scene.isActive("Boot");
    const ok = await (async () => {
      for (let i = 0; i < 30; i++) { if (hasText()) return true; await sleep(100); }
      return false;
    })();
    return { bootActive: ok, sceneKeys: window.__game.scene.getScenes(true).map(s => s.scene.key) };
  });
  console.log("1. Boot 场景激活:", boot.bootActive, "| 活动场景:", boot.sceneKeys.join(","));

  // ---- 2. 点「新的探索」→ 分队选择 ----
  // 按钮在 (640,500) 附近；无存档时只有一个按钮
  const teamSelect = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const g = window.__game;
    const boot = g.scene.getScenes(true).find(s => s.scene.key === "Boot");
    if (boot) return { error: "Boot 仍是活动场景" };
    // Rogue 无 run → 应显示分队选择
    const rogue = g.scene.getScene("Rogue");
    return { rogueActive: g.scene.isActive("Rogue") };
  });
  // 先点击画布 (640,500)
  await page.mouse.click(640, 500);
  await sleep(800);
  const afterClick = await page.evaluate(() => {
    const g = window.__game;
    return { scenes: g.scene.getScenes(true).map(s => s.scene.key), bootActive: g.scene.isActive("Boot") };
  });
  console.log("2. 点击新的探索后:", JSON.stringify(afterClick));

  // ---- 3. 选分队 → 节点图 → 存档 ----
  await page.mouse.click(505, 340); // 第一张分队卡片中心（x 380..630）
  await sleep(1000);
  const mapState = await page.evaluate(() => {
    const g = window.__game;
    const save = localStorage.getItem("redshadow_save");
    return {
      scenes: g.scene.getScenes(true).map(s => s.scene.key),
      hasSave: !!save,
      saveVersion: save ? JSON.parse(save).saveVersion : null,
      floor: save ? JSON.parse(save).run.floor : null
    };
  });
  console.log("3. 选分队后:", JSON.stringify(mapState));

  // ---- 4. 刷新 → 「继续探索」→ 恢复 ----
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1200);
  const reloaded = await page.evaluate(() => {
    const g = window.__game;
    const save = localStorage.getItem("redshadow_save");
    return { bootActive: g.scene.isActive("Boot"), hasSave: !!save };
  });
  console.log("4. 刷新后 Boot:", reloaded.bootActive, "存档在:", reloaded.hasSave);

  await page.mouse.click(640, 470); // 继续探索按钮
  await sleep(1000);
  const resumed = await page.evaluate(() => {
    const g = window.__game;
    return { scenes: g.scene.getScenes(true).map(s => s.scene.key) };
  });
  console.log("5. 继续探索后活动场景:", resumed.scenes.join(","));

  console.log("控制台错误:", errors.length === 0 ? "无 ✓" : errors.join("\n"));
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
})();
