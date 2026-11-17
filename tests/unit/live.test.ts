import { describe, it, expect } from "vitest";
import { clockText, currentMinute, minuteLabel } from "@/lib/live";
import { matchTitle, scoreText } from "@/lib/data";
import { rowsToMatches } from "@/lib/calendar-import";

describe("Match en direct", () => {
  const t0 = Date.parse("2026-11-22T14:00:00Z");
  it("minute en cours et chrono", () => {
    const first = { live_status: "premiere" as const, live_started_at: "2026-11-22T14:00:00Z", second_half_started_at: null };
    expect(currentMinute(first, t0 + 30_000)).toEqual({ minute: 1, period: 1 });
    expect(currentMinute(first, t0 + 23 * 60_000 + 5_000)).toEqual({ minute: 24, period: 1 });
    expect(clockText(first, t0 + 23 * 60_000 + 5_000)).toBe("23:05");
    const second = { live_status: "seconde" as const, live_started_at: "2026-11-22T14:00:00Z", second_half_started_at: "2026-11-22T15:00:00Z" };
    expect(currentMinute(second, Date.parse("2026-11-22T15:05:30Z"))).toEqual({ minute: 51, period: 2 });
    expect(clockText(second, Date.parse("2026-11-22T15:05:30Z"))).toBe("50:30");
  });
  it("temps additionnel", () => {
    expect(minuteLabel(47, 1)).toBe("45+2'");
    expect(minuteLabel(93, 2)).toBe("90+3'");
    expect(minuteLabel(12, 1)).toBe("12'");
    expect(minuteLabel(null, null)).toBe("");
  });
});

describe("Domicile / extérieur", () => {
  it("le club qui reçoit est cité en premier, score dans le même ordre", () => {
    expect(matchTitle({ opponent: "Barchon", is_home: true, club_name: "Aubel" })).toBe("Aubel – Barchon");
    expect(matchTitle({ opponent: "Barchon", is_home: false, club_name: "Aubel" })).toBe("Barchon – Aubel");
    expect(scoreText({ score_for: 3, score_against: 1, is_home: false })).toBe("1 – 3");
    expect(scoreText({ score_for: 3, score_against: 1, is_home: true })).toBe("3 – 1");
  });
  it("import : colonne domicile, sinon déduit du lieu", () => {
    const d = { opensAfterHours: null, deadlineAfterHours: 48, closesAfterHours: null };
    const { matches } = rowsToMatches(
      [
        ["date", "heure", "adversaire", "lieu", "domicile"],
        ["08/11/2026", "15:00", "A", "Barchon", ""],
        ["09/11/2026", "15:00", "B", "Aubel", ""],
        ["10/11/2026", "15:00", "C", "", ""],
        ["11/11/2026", "15:00", "D", "Aubel", "non"],
      ],
      d,
    );
    expect(matches.map((m) => m.home)).toEqual([false, true, true, false]);
  });
});
