import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { adminClient, createOpenMatch, createPlayers, loginMaitre, sql, vote, type TestPlayer } from "./helpers";
import { getVapidKeys, sendPendingNotifications, sendTestNotification } from "../../src/lib/push";

// Faux service de push (remplace FCM / Apple / Mozilla) pour vérifier
// l'envoi réel : chiffrement, en-têtes VAPID, nettoyage des abonnements.
type Received = { path: string; headers: http.IncomingHttpHeaders; bytes: number };

describe("Envoi des notifications push", () => {
  const received: Received[] = [];
  let server: https.Server;
  let base: string;
  let p: TestPlayer[];

  const keys = () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  };

  beforeAll(async () => {
    // Certificat auto-signé : web-push n'envoie qu'en HTTPS
    const dir = mkdtempSync(path.join(tmpdir(), "push-"));
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"),
    ], { stdio: "ignore" });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const tls = { key: readFileSync(path.join(dir, "key.pem")), cert: readFileSync(path.join(dir, "cert.pem")) };
    server = https.createServer(tls, (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bytes = 0;
      req.on("data", (c) => (bytes += c.length));
      req.on("end", () => {
        received.push({ path: req.url ?? "", headers: req.headers, bytes });
        res.writeHead(req.url?.includes("expire") ? 410 : 201).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    p = await createPlayers(4, "push");
  });

  afterAll(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    return new Promise<void>((r) => server.close(() => r()));
  });

  it("génère les clés VAPID une seule fois et les conserve", async () => {
    const a = await getVapidKeys(adminClient());
    const b = await getVapidKeys(adminClient());
    expect(a).toEqual(b);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });

  it("envoie l'ouverture aux non-votants abonnés, une seule fois, et supprime les abonnements expirés", async () => {
    const admin = adminClient();
    await sql("update app_settings set notify_on_open = true, reminder_hours = 3");
    for (const [i, path] of [[0, "/sub/a"], [1, "/sub/expire"], [2, "/sub/c"]] as const) {
      const k = keys();
      await sql("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)", [
        p[i].userId, base + path, k.p256dh, k.auth,
      ]);
    }
    const maitre = await loginMaitre();
    const m = await createOpenMatch(maitre, p.map((x) => x.playerId), { deadlineMinutes: 24 * 60 });
    // p2 a déjà voté : il ne reçoit rien ; p3 n'a pas activé les notifications
    expect((await vote(p[2].client, m, [p[0].playerId, p[1].playerId, p[3].playerId])).error).toBeNull();
    received.length = 0;

    const report = await sendPendingNotifications(admin, "https://aubel.example");
    const paths = received.map((r) => r.path).sort();
    expect(paths).toEqual(["/sub/a", "/sub/expire"]);
    expect(report.sent).toBe(1);
    expect(report.removed).toBe(1);
    const headers = received.find((r) => r.path === "/sub/a")!.headers;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(String(headers.authorization)).toMatch(/^vapid t=.+, k=.+/);
    expect(Number(headers.ttl)).toBe(6 * 3600);
    expect(received.find((r) => r.path === "/sub/a")!.bytes).toBeGreaterThan(100); // charge utile chiffrée
    expect(await sql("select 1 from push_subscriptions where endpoint like '%expire'")).toHaveLength(0);

    // Deuxième passage : rien de nouveau
    received.length = 0;
    const again = await sendPendingNotifications(admin, "https://aubel.example");
    expect(again.pending).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("notification de test vers ses propres appareils", async () => {
    received.length = 0;
    const r = await sendTestNotification(adminClient(), p[0].userId, "https://aubel.example");
    expect(r.sent).toBe(1);
    expect(received.map((x) => x.path)).toEqual(["/sub/a"]);
  });
});
