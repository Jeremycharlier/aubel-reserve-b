import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendPendingNotifications } from "@/lib/push";

// Planificateur de secours (Vercel Cron, une fois par jour). Le planificateur
// principal est pg_cron dans Supabase. Cet appel quotidien maintient aussi le
// projet Supabase actif pendant les trêves.
export async function GET(request: NextRequest) {
  const admin = createServiceClient();
  if (!(await isAuthorizedCron(request.headers.get("authorization"), admin))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { data, error } = await admin.rpc("process_vote_schedule");
  if (error) return NextResponse.json({ error: "Échec du traitement" }, { status: 500 });
  let notifications = null;
  try {
    notifications = await sendPendingNotifications(admin, request.nextUrl.origin);
  } catch {
    notifications = { error: true };
  }
  return NextResponse.json({ ok: true, updated: data, notifications });
}
