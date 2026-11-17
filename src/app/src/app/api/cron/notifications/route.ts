import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendPendingNotifications, sendScheduledNotifications } from "@/lib/push";

// Appelé toutes les 10 minutes par la base (pg_cron + pg_net), seulement
// lorsqu'il y a des notifications à envoyer.
async function handle(request: NextRequest) {
  const admin = createServiceClient();
  if (!(await isAuthorizedCron(request.headers.get("authorization"), admin))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    await admin.rpc("process_vote_schedule");
    const auto = await sendPendingNotifications(admin, request.nextUrl.origin);
    const scheduled = await sendScheduledNotifications(admin, request.nextUrl.origin);
    return NextResponse.json({ ok: true, auto, scheduled });
  } catch {
    return NextResponse.json({ error: "Échec de l'envoi" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
