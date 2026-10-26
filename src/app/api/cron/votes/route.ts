import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

// Planificateur de secours (Vercel Cron ou tout service externe).
// Le planificateur principal est pg_cron dans Supabase (chaque minute).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    given.length !== expected.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { data, error } = await createServiceClient().rpc("process_vote_schedule");
  if (error) return NextResponse.json({ error: "Échec du traitement" }, { status: 500 });
  return NextResponse.json({ ok: true, updated: data });
}
