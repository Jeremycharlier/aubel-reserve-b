// Parcours navigateur des améliorations (surnom, feuille avec statuts,
// statistiques, page match, liste joueurs, import, suppression).
// Prérequis identiques à parcours.mjs (app lancée + npm run seed:demo).
//   CHROME_PATH=… node tests/e2e/ameliorations.mjs
import puppeteer from "puppeteer-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const check = (c, l) => { console.log(`${c ? "OK " : "ÉCHEC"} ${l}`); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox"] });
async function login(page, u, pw) {
  await page.goto(base + "/connexion", { waitUntil: "networkidle0" });
  await page.type("input[name=username]", u); await page.type("input[name=password]", pw);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  await page.waitForSelector("h1", { timeout: 15000 });
}
const notice = async (page) => {
  await page.waitForSelector("[role=status],[role=alert]", { timeout: 15000 });
  await sleep(300);
  return page.$$eval("[role=status],[role=alert]", (els) => els.map((e) => e.innerText).join(" | "));
};
const clickText = (page, sel, text) => page.$$eval(sel, (els, t) => els.find((e) => e.innerText.includes(t)).click(), text);
const text = (page) => page.evaluate(() => document.body.innerText);

const b = await launch();

// 1. Le joueur choisit un surnom
const j = await b.newPage(); await j.setViewport({ width: 390, height: 844 });
await login(j, "julien.franssen", "Demo-2026");
await j.goto(base + "/profil", { waitUntil: "networkidle0" });
const nick = `Juju${Date.now().toString(36).slice(-3)}`;
await j.$eval("input[name=nickname]", (e) => (e.value = ""));
await j.type("input[name=nickname]", nick);
await j.click("input[name=use_nickname]");
await clickText(j, "button[type=submit]", "Enregistrer mon profil");
check((await notice(j)).includes("Profil enregistré"), "surnom enregistré par le joueur");
await j.goto(base + "/joueurs", { waitUntil: "networkidle0" });
check((await text(j)).includes(nick) && (await text(j)).includes("Julien Franssen"), "liste des joueurs : surnom affiché avec le vrai nom en dessous");
check((await j.$$('a[href^="/joueurs?tri="]')).length === 4, "liste des joueurs : tris buts / passes / cartons / nom");

// 2. Le maître : feuille de match avec statuts, statistiques
const b2 = await launch(); // session séparée pour le maître
const m = await b2.newPage(); await m.setViewport({ width: 390, height: 844 });
await login(m, "coach", "Demo-2026");
await m.goto(base + "/maitre/matchs", { waitUntil: "networkidle0" });
const upcoming = await m.$$eval('a[href^="/maitre/matchs/"]', (as) => as.map((a) => [a.getAttribute("href"), a.innerText]).find(([, t]) => t.includes("Battice"))[0]);
await m.goto(base + upcoming, { waitUntil: "networkidle0" });
const mid = upcoming.split("/").pop();
const selects = await m.$$('select[name^="role_"]');
await selects[0].select("supporter");
await clickText(m, "button[type=submit]", "Enregistrer la feuille");
check((await notice(m)).includes("Feuille de match enregistrée"), "feuille de match avec statut supporter");
await m.reload({ waitUntil: "networkidle0" });
const firstGoals = await m.$('input[name^="goals_"]');
await firstGoals.type("2");
const firstYellow = await m.$('input[name^="yellow_"]');
await firstYellow.type("3");
await m.type("input[name=score_for]", "4");
await m.type("input[name=score_against]", "0");
check(await firstYellow.evaluate((e) => e.validity.rangeOverflow), "contrôle : 3 cartons jaunes refusés par le formulaire");
await firstYellow.evaluate((e) => (e.value = "1"));
await clickText(m, "button[type=submit]", "Enregistrer score");
check((await notice(m)).includes("Score et statistiques enregistrés"), "score et statistiques enregistrés");

// 3. Le joueur voit les présents, les faits du match et le score
await j.goto(`${base}/match/${mid}`, { waitUntil: "networkidle0" });
const jt = await text(j);
check(jt.includes("4 – 0"), "page match : score visible");
check(jt.includes("Présents") && jt.includes("Supporter"), "page match : présents et statuts visibles");
check(jt.includes("Buts") && jt.includes("Cartons jaunes"), "page match : buteurs et cartons visibles");
check(await j.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page match : pas de défilement horizontal");

// 4. Import d'un calendrier CSV
const dir = mkdtempSync(path.join(tmpdir(), "cal-"));
const csv = path.join(dir, "calendrier.csv");
writeFileSync(csv, "﻿date;heure;adversaire;lieu;classement\n14/03/2027;15:00;Import Test A;Aubel;oui\n21/03/2027;14h30;Import Test B;;non\n99/03/2027;15:00;Ligne fausse;;\n");
await m.goto(base + "/maitre/matchs/import", { waitUntil: "networkidle0" });
await (await m.$("input[type=file]")).uploadFile(csv);
await clickText(m, "button[type=submit]", "Vérifier le fichier");
await m.waitForFunction(() => document.body.innerText.includes("à corriger"), { timeout: 15000 });
check((await text(m)).includes("Ligne 4"), "import : ligne invalide signalée avec son numéro");
writeFileSync(csv, "﻿date;heure;adversaire;lieu;classement\n14/03/2027;15:00;Import Test A;Aubel;oui\n21/03/2027;14h30;Import Test B;;non\n");
await (await m.$("input[type=file]")).uploadFile(csv);
await clickText(m, "button[type=submit]", "Vérifier le fichier");
await m.waitForFunction(() => document.body.innerText.includes("prêts à importer"), { timeout: 15000 });
await clickText(m, "button", "Importer 2 matchs");
await m.waitForFunction(() => document.body.innerText.includes("2 matchs créés"), { timeout: 15000 });
check(true, "import : 2 matchs créés");
const dl = await m.evaluate(async () => {
  const r = await fetch("/api/modele-calendrier?format=xlsx");
  return { status: r.status, type: r.headers.get("content-type"), size: (await r.arrayBuffer()).byteLength };
});
check(dl.status === 200 && dl.type.includes("spreadsheetml") && dl.size > 3000, "modèle Excel téléchargeable");

// 5. Suppression d'un match avec votes : confirmation SUPPRIMER
await m.goto(base + "/maitre/matchs", { waitUntil: "networkidle0" });
const voted = await m.$$eval('a[href^="/maitre/matchs/"]', (as) => as.map((a) => [a.getAttribute("href"), a.innerText]).find(([, t]) => t.includes("Warsage"))[0]);
await m.goto(base + voted, { waitUntil: "networkidle0" });
const del = async () => m.$$eval("button[type=submit]", (bs) => bs.find((x) => x.innerText.includes("Supprimer le match")).disabled);
check(await del(), "suppression bloquée tant que SUPPRIMER n'est pas tapé");
await m.type("input[name=confirm]", "supprimer");
check(!(await del()), "bouton actif après confirmation");
m.once("dialog", (d) => d.accept());
await Promise.all([m.waitForNavigation({ waitUntil: "networkidle0" }), clickText(m, "button[type=submit]", "Supprimer le match")]);
check(!(await text(m)).includes("Warsage"), "match avec votes supprimé");
await m.goto(base + "/maitre/journal", { waitUntil: "networkidle0" });
check((await text(m)).includes("Suppression de match"), "suppression inscrite au journal");

// 6. Export CSV de l'équipe (maître) refusé au joueur
const csvRes = await m.evaluate(async () => { const r = await fetch("/api/joueurs/csv"); return { s: r.status, t: await r.text() }; });
check(csvRes.s === 200 && csvRes.t.includes("Date de naissance"), "export CSV de l'équipe (maître)");
check((await j.evaluate(async () => (await fetch("/api/joueurs/csv")).status)) === 403, "export CSV refusé au joueur");

await b.close();
await b2.close();
