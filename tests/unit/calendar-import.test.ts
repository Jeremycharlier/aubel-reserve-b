import { describe, it, expect } from "vitest";
import { addHours, parseDate, parseDateTime, parseTime, rowsToMatches, TEMPLATE_EXAMPLE, TEMPLATE_HEADERS } from "@/lib/calendar-import";
import { parseCsv, toCsv } from "@/lib/csv";

const defaults = { opensAfterHours: 2, deadlineAfterHours: 48, closesAfterHours: 72 };

describe("Import de calendrier", () => {
  it("lit les formats de date et d'heure courants", () => {
    expect(parseDate("08/11/2026")).toEqual({ y: 2026, m: 11, d: 8 });
    expect(parseDate("8/11/26")).toEqual({ y: 2026, m: 11, d: 8 });
    expect(parseDate("2026-11-08")).toEqual({ y: 2026, m: 11, d: 8 });
    expect(parseDate("08.11.2026")).toEqual({ y: 2026, m: 11, d: 8 });
    expect(parseTime("15:00")).toEqual({ h: 15, min: 0 });
    expect(parseTime("15h30")).toEqual({ h: 15, min: 30 });
    expect(parseTime("15h")).toEqual({ h: 15, min: 0 });
    expect(parseTime("15:00:00")).toEqual({ h: 15, min: 0 });
    expect(parseDateTime("15/11/2026 17:00")).toEqual({ y: 2026, m: 11, d: 15, h: 17, min: 0 });
    expect(parseDateTime("31/02/2026 17:00")).toBeNull();
  });

  it("ajoute des heures à l'horloge murale (passage de mois)", () => {
    expect(addHours({ y: 2026, m: 11, d: 30, h: 15, min: 0 }, 48)).toEqual({ y: 2026, m: 12, d: 2, h: 15, min: 0 });
  });

  it("le modèle fourni s'importe sans erreur, avec les règles par défaut", () => {
    const csv = toCsv([[...TEMPLATE_HEADERS], ...TEMPLATE_EXAMPLE]);
    const { matches, errors } = rowsToMatches(parseCsv(csv), defaults);
    expect(errors).toEqual([]);
    expect(matches).toHaveLength(3);
    expect(matches[0]).toMatchObject({
      opponent: "FC Herve C",
      kickoff: "2026-11-08T15:00:00",
      opens: "2026-11-08T17:00:00",
      deadline: "2026-11-10T15:00:00",
      closes: "2026-11-11T15:00:00",
      counts: true,
    });
    // Horaires explicites prioritaires
    expect(matches[1]).toMatchObject({ opens: "2026-11-15T17:00:00", deadline: "2026-11-17T20:00:00", closes: "2026-11-18T20:00:00" });
    expect(matches[2].counts).toBe(false);
  });

  it("ouverture / fermeture manuelles", () => {
    const { matches } = rowsToMatches(
      [["Date", "Heure", "Adversaire"], ["08/11/2026", "15:00", "X"]],
      { opensAfterHours: null, deadlineAfterHours: 24, closesAfterHours: null },
    );
    expect(matches[0]).toMatchObject({ opens: null, closes: null, deadline: "2026-11-09T15:00:00" });
  });

  it("en-têtes tolérants (accents, majuscules, synonymes) et séparateur virgule", () => {
    const csv = "Date du match,Coup d'envoi,Équipe adverse,Terrain\n08/11/2026,15h,RFC Test,Aubel\n";
    const { matches, errors } = rowsToMatches(parseCsv(csv), defaults);
    expect(errors).toEqual([]);
    expect(matches[0]).toMatchObject({ opponent: "RFC Test", location: "Aubel", kickoff: "2026-11-08T15:00:00" });
  });

  it("signale clairement les lignes invalides avec leur numéro", () => {
    const table = [
      ["date", "heure", "adversaire", "classement"],
      ["08/11/2026", "15:00", "OK FC", ""],
      ["32/11/2026", "15:00", "Mauvaise date", ""],
      ["09/11/2026", "", "Sans heure", ""],
      ["10/11/2026", "15:00", "", ""],
      ["11/11/2026", "15:00", "Classement ?", "peut-être"],
    ];
    const { matches, errors } = rowsToMatches(table, defaults);
    expect(matches).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(rowsToMatches([["nom", "x"]], defaults).errors[0].message).toContain("date");
  });

  it("CSV : guillemets, points-virgules et neutralisation des formules", () => {
    const out = toCsv([["a;b", 'dit "oui"', "=SOMME(A1)"]]);
    expect(out).toContain('"a;b";"dit ""oui""";\'=SOMME(A1)');
    expect(parseCsv(out)).toEqual([["a;b", 'dit "oui"', "'=SOMME(A1)"]]);
  });
});
