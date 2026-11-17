import { NextResponse, type NextRequest } from "next/server";
import { TEMPLATE_EXAMPLE, TEMPLATE_HEADERS } from "@/lib/calendar-import";
import { toCsv } from "@/lib/csv";
import { buildTemplate } from "@/lib/xlsx";

// Modèle de calendrier à remplir (Excel ou CSV).
export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (format === "csv") {
    return new NextResponse(toCsv([[...TEMPLATE_HEADERS], ...TEMPLATE_EXAMPLE]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="modele-calendrier-aubel.csv"',
      },
    });
  }
  const buf = await buildTemplate(TEMPLATE_HEADERS, TEMPLATE_EXAMPLE);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-calendrier-aubel.xlsx"',
    },
  });
}
