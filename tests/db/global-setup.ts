// Prépare une pile Supabase locale (Postgres + Auth + PostgREST) neuve,
// applique les migrations et crée le compte maître de test.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import { bootstrapMaitre } from "../../src/lib/accounts";

export const TEST_DOMAIN = "joueurs.aubel-reserve-b.invalid";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    anonKey: string;
    serviceKey: string;
    maitre: { username: string; password: string; userId: string; playerId: string };
  }
}

export default async function setup(project: TestProject) {
  const root = path.resolve(__dirname, "../..");
  if (process.env.SKIP_STACK_RESET !== "1") {
    execFileSync(path.join(root, "scripts/stack/start.sh"), { stdio: "inherit" });
  }
  const keys = Object.fromEntries(
    readFileSync(path.join(root, ".stack/run/keys.env"), "utf8")
      .trim()
      .split("\n")
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const supabaseUrl = "http://127.0.0.1:54321";
  const admin = createClient(supabaseUrl, keys.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const maitre = { username: "coach.test", password: "Maitre-Test-2026" };
  const created = await bootstrapMaitre(admin, TEST_DOMAIN, {
    username: maitre.username,
    displayName: "Coach Test",
    password: maitre.password,
    shirtNumber: 10,
  });

  project.provide("supabaseUrl", supabaseUrl);
  project.provide("anonKey", keys.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  project.provide("serviceKey", keys.SUPABASE_SERVICE_ROLE_KEY);
  project.provide("maitre", { ...maitre, ...created });
}
