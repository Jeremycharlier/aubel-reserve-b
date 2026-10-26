import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { buildStandingsPdf, type StandingRow } from "@/lib/pdf";
import { fmtPrecise } from "@/lib/time";

// Export PDF du classement : généré côté serveur après vérification du
// rôle maître (ici puis dans la base). Ne contient aucun bulletin.
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "maitre" || viewer.mustChangePassword) {
    return NextResponse.json({ error: "Accès réservé au maître." }, { status: 403 });
  }
  const seasonId = request.nextUrl.searchParams.get("saison") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(seasonId)) {
    return NextResponse.json({ error: "Saison invalide." }, { status: 400 });
  }

  const supabase = await createUserClient();
  const [{ data: season }, { data: rows, error }, { data: settings }] = await Promise.all([
    supabase.from("seasons").select("name").eq("id", seasonId).maybeSingle(),
    supabase.rpc("admin_season_standings", { p_season_id: seasonId }),
    supabase.from("app_settings").select("team_name, late_penalty_enabled, late_penalty_points, nonvote_penalty_enabled, nonvote_penalty_points").eq("id", 1).maybeSingle(),
  ]);
  if (error || !season) {
    return NextResponse.json({ error: "Classement indisponible." }, { status: error?.message === "FORBIDDEN" ? 403 : 404 });
  }

  const penaltyParts = [
    settings?.late_penalty_enabled ? `retard ${settings.late_penalty_points} pt(s)` : null,
    settings?.nonvote_penalty_enabled ? `absence de vote ${settings.nonvote_penalty_points} pt(s)` : null,
  ].filter(Boolean);
  const pdf = await buildStandingsPdf({
    teamName: settings?.team_name ?? "Aubel Réserve B",
    seasonName: season.name,
    generatedAt: fmtPrecise(new Date().toISOString()),
    rows: (rows ?? []) as StandingRow[],
    penaltyNote: penaltyParts.length
      ? `Malus en vigueur : ${penaltyParts.join(", ")}, appliqué(s) une seule fois par joueur et par match.`
      : "Aucun malus actif actuellement.",
  });

  const filename = `classement-aubel-reserve-b-${season.name.replace(/[^a-zA-Z0-9-]+/g, "-")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
