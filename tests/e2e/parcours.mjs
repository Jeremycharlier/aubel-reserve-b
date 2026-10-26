// Parcours de bout en bout dans un vrai navigateur (smartphone 390 px).
// Prérequis : l'application lancée (npm run build && npm start) sur une base
// de démonstration (npm run seed:demo), et Chrome/Chromium installé.
//   CHROME_PATH=/chemin/vers/chrome BASE_URL=http://localhost:3000 node tests/e2e/parcours.mjs
import puppeteer from "puppeteer-core";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => { console.log(`${cond ? "OK " : "ÉCHEC"} ${label}`); if (!cond) process.exitCode = 1; };
async function login(page, u, pw) {
  await page.goto(base + "/connexion", { waitUntil: "networkidle0" });
  await page.type("input[name=username]", u); await page.type("input[name=password]", pw);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  await page.waitForSelector("h1", { timeout: 15000 });
}
const suffix = Date.now().toString(36);

// 1. Le maître crée un compte joueur
const b1 = await launch(); const m = await b1.newPage(); await m.setViewport({ width: 390, height: 844 });
await login(m, "coach", "Demo-2026");
await m.goto(base + "/maitre/equipe", { waitUntil: "networkidle0" });
await m.type("input[name=new_player_name]", `Essai ${suffix}`);
await m.type("input[name=username]", `essai.${suffix}`);
await m.$$eval("button[type=submit]", (bs) => bs.find((x) => x.innerText.includes("Créer le compte")).click());
await m.waitForSelector("[role=status],[role=alert]", { timeout: 15000 }); await sleep(800);
const temp = (await m.evaluate(() => document.body.innerText)).match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)?.[0];
check(!!temp, "création de compte avec mot de passe temporaire");

// 2. Export PDF par le maître
const season = await m.evaluate(async () => (await (await fetch("/maitre/classement")).text()).match(/api\/classement\/pdf\?saison=([0-9a-f-]{36})/)[1]);
const pdf = await m.evaluate(async (s) => { const r = await fetch("/api/classement/pdf?saison=" + s); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, head: String.fromCharCode(...b.slice(0, 5)) }; }, season);
check(pdf.status === 200 && pdf.head === "%PDF-", "export PDF du classement (maître)");

// 3. Première connexion du joueur
const b2 = await launch(); const p = await b2.newPage(); await p.setViewport({ width: 390, height: 844 });
await login(p, `essai.${suffix}`, temp);
await p.goto(base + "/", { waitUntil: "networkidle0" });
check(p.url().endsWith("/premiere-connexion"), "changement de mot de passe imposé");
await p.type("input[name=password]", "MonMotDePasse7"); await p.type("input[name=confirm]", "MonMotDePasse7");
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.click("button[type=submit]")]);
check(p.url() === base + "/", "accès à l'accueil après changement");

// 4. Le joueur n'accède ni à l'administration ni au PDF
await p.goto(base + "/maitre/classement", { waitUntil: "networkidle0" });
check((await p.evaluate(() => document.querySelector("h1")?.innerText)) === "Page introuvable", "classement maître refusé au joueur");
check((await p.evaluate(async (s) => (await fetch("/api/classement/pdf?saison=" + s)).status, season)) === 403, "PDF refusé au joueur (403)");

// 5. Déconnexion
await p.goto(base + "/profil", { waitUntil: "networkidle0" });
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.$$eval("button", (bs) => bs.find((x) => x.innerText.includes("Se déconnecter")).click())]);
await p.goto(base + "/historique", { waitUntil: "networkidle0" });
check(p.url().endsWith("/connexion"), "déconnexion effective");
await b2.close();

// 6. Vote complet d'un joueur de la démo sur le match ouvert
const b3 = await launch(); const v = await b3.newPage(); await v.setViewport({ width: 390, height: 844 });
await login(v, "loic.pirard", "Demo-2026");
await v.goto(base + "/", { waitUntil: "networkidle0" });
const href = await v.$eval('a[href^="/vote/"]', (a) => a.getAttribute("href")).catch(() => null);
if (href) {
  await v.goto(base + href, { waitUntil: "networkidle0" });
  const btns = await v.$$('ul[aria-label="Coéquipiers présents"] button');
  for (const i of [2, 5, 0]) { await btns[i].evaluate((e) => e.click()); await sleep(100); }
  const podium = await v.$$eval('section[aria-label="Vos trois choix"] li', (ls) => ls.map((l) => l.innerText));
  check(podium[0].startsWith("3") && podium[1].startsWith("2") && podium[2].startsWith("1"), "podium 3 / 2 / 1");
  await v.$$eval("button", (bs) => bs.find((x) => /Valider|Enregistrer la modification/.test(x.innerText)).click());
  await v.waitForFunction(() => /Vote (validé|modifié)/.test(document.body.innerText), { timeout: 10000 });
  check(true, "vote validé avec confirmation");
  check(await v.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "aucun défilement horizontal");
} else check(false, "un vote ouvert est disponible");
await b3.close(); await b1.close();
