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

// 2. Disponibilité du joueur, puis l'entraîneur compose et valide la feuille
const b2 = await launch(); // session séparée pour l'entraîneur
const m = await b2.newPage(); await m.setViewport({ width: 390, height: 844 });
await login(m, "entraineur", "Demo-2026");
await m.goto(base + "/gestion/matchs", { waitUntil: "networkidle0" });
const upcoming = await m.$$eval('a[href^="/gestion/matchs/"]', (as) => as.map((a) => [a.getAttribute("href"), a.innerText]).find(([, t]) => t.includes("Battice"))[0]);
const mid = upcoming.split("/").pop();
check((await text(m)).includes("Battice FC B – Aubel"), "calendrier : le club qui reçoit est cité en premier");

await j.goto(`${base}/match/${mid}`, { waitUntil: "networkidle0" });
await clickText(j, "button[role=radio]", "Présent");
check((await notice(j)).includes("disponible"), "joueur : disponibilité enregistrée");

await m.goto(base + upcoming, { waitUntil: "networkidle0" });
check((await text(m)).includes("Disponibilités"), "entraîneur : tableau des disponibilités");
check(!(await text(m)).includes("Bulletins"), "entraîneur : aucun accès aux votes");
await clickText(m, "button", "Cocher les présents");
const selects = await m.$$('select[name^="role_"]');
check(selects.length >= 1, "feuille : joueur présent coché");
await clickText(m, "button[type=submit]", "Enregistrer la feuille");
check((await notice(m)).includes("Feuille de match enregistrée"), "feuille de match enregistrée par l'entraîneur");
await m.reload({ waitUntil: "networkidle0" });
m.once("dialog", (d) => d.accept());
await clickText(m, "button[type=submit]", "Valider la feuille et convoquer");
await notice(m);
await m.reload({ waitUntil: "networkidle0" });
check((await text(m)).includes("Rouvrir les disponibilités"), "feuille validée (convocations)");
await m.goto(base + "/gestion/notifications", { waitUntil: "networkidle0" });
check(!(await text(m)).includes("Envoyer ou programmer"), "entraîneur : page notifications réservée à l'administrateur");

// 3. Encodage en direct
await m.goto(`${base}/match/${mid}/direct`, { waitUntil: "networkidle0" });
await clickText(m, "button", "Coup d'envoi");
await m.waitForFunction(() => document.body.innerText.includes("1re mi-temps") || document.body.innerText.includes("mi-temps"), { timeout: 15000 });
await clickText(m, "button", "But Aubel");
await m.waitForSelector("section[aria-label='But']");
await m.$$eval("section[aria-label='But'] button", (bs) => bs.find((x) => /\S/.test(x.innerText) && !x.innerText.includes("inconnu") && !x.innerText.includes("Pas de passe") && x.getAttribute("aria-label") !== "Annuler").click());
await m.$eval("section[aria-label='But'] input[type=number]", (e) => (e.value = ""));
await m.type("section[aria-label='But'] input[type=number]", "12");
await clickText(m, "button", "Enregistrer");
await m.waitForFunction(() => document.body.innerText.includes("12'"), { timeout: 15000 });
check((await text(m)).includes("0 – 1"), "direct : but à l'extérieur affiché 0 – 1 (Battice – Aubel)");
check(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "direct : pas de défilement horizontal");
await m.screenshot({ path: "/tmp/direct.png", fullPage: true });

await j.goto(`${base}/match/${mid}`, { waitUntil: "networkidle0" });
const jt = await text(j);
check(jt.includes("0 – 1") && jt.includes("12'"), "page match : score et minute visibles par le joueur");
check(jt.includes("Tu es convoqué") || jt.includes("convoqué"), "page match : convocation visible");
check(await j.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page match : pas de défilement horizontal");

// 3b. L'administrateur programme une notification
const b3 = await launch();
const a = await b3.newPage(); await a.setViewport({ width: 390, height: 844 });
await login(a, "coach", "Demo-2026");
await a.goto(base + "/gestion/notifications", { waitUntil: "networkidle0" });
await a.type("input[name=title]", "Test programmé");
await a.type("textarea[name=body]", "Message de test E2E");
await a.select("select[name=when]", "plus_tard");
await a.$eval("input[name=send_at]", (e) => {
  const d = new Date(Date.now() + 86400000);
  const p = (n) => String(n).padStart(2, "0");
  const v = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(e, v); e.dispatchEvent(new Event("input", { bubbles: true }));
});
await clickText(a, "button[type=submit]", "Programmer");
await notice(a);
await a.reload({ waitUntil: "networkidle0" });
check((await text(a)).includes("Test programmé") && (await text(a)).includes("Programmé"), "administrateur : notification programmée listée");
await a.screenshot({ path: "/tmp/notifications.png", fullPage: true });

// 4. Import d'un calendrier CSV
const dir = mkdtempSync(path.join(tmpdir(), "cal-"));
const csv = path.join(dir, "calendrier.csv");
writeFileSync(csv, "﻿date;heure;adversaire;lieu;classement\n14/03/2027;15:00;Import Test A;Aubel;oui\n21/03/2027;14h30;Import Test B;;non\n99/03/2027;15:00;Ligne fausse;;\n");
await a.goto(base + "/gestion/matchs/import", { waitUntil: "networkidle0" });
await (await a.$("input[type=file]")).uploadFile(csv);
await clickText(a, "button[type=submit]", "Vérifier le fichier");
await a.waitForFunction(() => document.body.innerText.includes("à corriger"), { timeout: 15000 });
check((await text(a)).includes("Ligne 4"), "import : ligne invalide signalée avec son numéro");
writeFileSync(csv, "﻿date;heure;adversaire;lieu;classement\n14/03/2027;15:00;Import Test A;Aubel;oui\n21/03/2027;14h30;Import Test B;;non\n");
await (await a.$("input[type=file]")).uploadFile(csv);
await clickText(a, "button[type=submit]", "Vérifier le fichier");
await a.waitForFunction(() => document.body.innerText.includes("prêts à importer"), { timeout: 15000 });
await clickText(a, "button", "Importer 2 matchs");
await a.waitForFunction(() => document.body.innerText.includes("2 matchs créés"), { timeout: 15000 });
check(true, "import : 2 matchs créés");
const dl = await a.evaluate(async () => {
  const r = await fetch("/api/modele-calendrier?format=xlsx");
  return { status: r.status, type: r.headers.get("content-type"), size: (await r.arrayBuffer()).byteLength };
});
check(dl.status === 200 && dl.type.includes("spreadsheetml") && dl.size > 3000, "modèle Excel téléchargeable");

// 5. Suppression d'un match avec votes : confirmation SUPPRIMER
await a.goto(base + "/gestion/matchs", { waitUntil: "networkidle0" });
const voted = await a.$$eval('a[href^="/gestion/matchs/"]', (as) => as.map((a) => [a.getAttribute("href"), a.innerText]).find(([, t]) => t.includes("Warsage"))[0]);
await a.goto(base + voted, { waitUntil: "networkidle0" });
const del = async () => a.$$eval("button[type=submit]", (bs) => bs.find((x) => x.innerText.includes("Supprimer le match")).disabled);
check(await del(), "suppression bloquée tant que SUPPRIMER n'est pas tapé");
await a.type("input[name=confirm]", "supprimer");
check(!(await del()), "bouton actif après confirmation");
a.once("dialog", (d) => d.accept());
await Promise.all([a.waitForNavigation({ waitUntil: "networkidle0" }), clickText(a, "button[type=submit]", "Supprimer le match")]);
check(!(await text(a)).includes("Warsage"), "match avec votes supprimé");
await a.goto(base + "/gestion/journal", { waitUntil: "networkidle0" });
check((await text(a)).includes("Suppression de match"), "suppression inscrite au journal");

// 6. Export CSV de l'équipe (administrateur) refusé au joueur
const csvRes = await a.evaluate(async () => { const r = await fetch("/api/joueurs/csv"); return { s: r.status, t: await r.text() }; });
check(csvRes.s === 200 && csvRes.t.includes("Date de naissance"), "export CSV de l'équipe (maître)");
check((await j.evaluate(async () => (await fetch("/api/joueurs/csv")).status)) === 403, "export CSV refusé au joueur");

await b.close();
await b2.close();
await b3.close();
