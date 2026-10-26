// Vérifie la page /installation sur une base SANS maître.
//   CHROME_PATH=… SETUP_TOKEN=… node tests/e2e/installation.mjs
import puppeteer from "puppeteer-core";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const check = (c, l) => { console.log(`${c ? "OK " : "ÉCHEC"} ${l}`); if (!c) process.exitCode = 1; };
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844 });
const fill = async (token) => {
  await p.goto(base + "/installation", { waitUntil: "networkidle0" });
  await p.type("input[name=token]", token); await p.type("input[name=display_name]", "Coach Install");
  await p.type("input[name=username]", "coach.install");
  await p.type("input[name=password]", "Installation-2026"); await p.type("input[name=confirm]", "Installation-2026");
  await p.click("button[type=submit]");
};
await fill("mauvais-code-mauvais-code");
await p.waitForSelector("[role=alert]", { timeout: 15000 });
check((await p.$eval("[role=alert]", (e) => e.innerText)).includes("incorrect"), "code d'installation erroné refusé");
await fill(process.env.SETUP_TOKEN);
await p.waitForFunction(() => location.pathname === "/maitre/reglages", { timeout: 15000 });
check(true, "compte maître créé et connecté");
await p.goto(base + "/installation", { waitUntil: "networkidle0" });
const txt = await p.evaluate(() => document.body.innerText);
check(txt.includes("installation est terminée"), "page désactivée après usage");
if (!txt.includes("installation est terminée")) console.log(txt.slice(0, 300));
await b.close();
