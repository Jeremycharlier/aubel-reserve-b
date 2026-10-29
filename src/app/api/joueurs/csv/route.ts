import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { createUserClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { PLAYER_COLUMNS, ROLE_LABEL, type PlayerRow } from "@/lib/data";

// Liste de l'équipe pour un usage extérieur (licences, anniversaires…). Maître uniquement.
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "maitre" || viewer.mustChangePassword) {
    return NextResponse.json({ error: "Accès réservé au maître." }, { status: 403 });
  }
  const supabase = await createUserClient();
  const [{ data: players }, { data: profiles }] = await Promise.all([
    supabase.from("players").select(PLAYER_COLUMNS).order("full_name"),
    supabase.from("profiles").select("player_id, username, active"),
  ]);
  const acc = new Map((profiles ?? []).map((p) => [p.player_id, p]));
  const rows = ((players ?? []) as PlayerRow[]).map((p) => {
    const birth = p.birth_date ? p.birth_date.split("-").reverse().join("/") : "";
    return [
      p.full_name,
      p.nickname ?? "",
      p.shirt_number ?? "",
      ROLE_LABEL[p.default_role],
      birth,
      acc.get(p.id)?.username ?? "",
      p.active ? "oui" : "non",
    ];
  });
  const csv = toCsv([["Nom", "Surnom", "Numéro", "Statut", "Date de naissance", "Identifiant", "Actif"], ...rows]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="equipe-aubel-reserve-b.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
