import { describe, it, expect } from "vitest";
import { fmtPrecise, parseLocalInput, timeUntil, toBrusselsInput } from "@/lib/time";
import { generateTempPassword, normalizeUsername, usernameToEmail, validateNewPassword } from "@/lib/accounts";
import { translateError } from "@/lib/errors";

describe("Heures de Bruxelles", () => {
  it("affiche l'heure belge quel que soit le fuseau du serveur (été et hiver)", () => {
    expect(toBrusselsInput("2026-07-12T16:00:00Z")).toBe("2026-07-12T18:00"); // UTC+2
    expect(toBrusselsInput("2026-12-13T17:00:00Z")).toBe("2026-12-13T18:00"); // UTC+1
  });
  it("gère la nuit du passage à l'heure d'hiver (25 oct. 2026)", () => {
    expect(toBrusselsInput("2026-10-25T00:30:00Z")).toBe("2026-10-25T02:30"); // encore UTC+2
    expect(toBrusselsInput("2026-10-25T01:30:00Z")).toBe("2026-10-25T02:30"); // déjà UTC+1
    expect(toBrusselsInput("2026-10-25T02:30:00Z")).toBe("2026-10-25T03:30");
  });
  it("valide les saisies datetime-local", () => {
    expect(parseLocalInput("2026-11-08T18:00")).toBe("2026-11-08T18:00:00");
    expect(parseLocalInput("")).toBeNull();
    expect(() => parseLocalInput("08/11/2026 18h")).toThrow();
  });
  it("formate précisément les horodatages serveur", () => {
    expect(fmtPrecise("2026-11-08T17:05:09Z")).toContain("18:05:09");
  });
  it("durées relatives", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(timeUntil("2026-11-08T12:45:00Z", now)).toBe("dans 45 min");
    expect(timeUntil("2026-11-08T14:15:00Z", now)).toBe("dans 2 h 15");
    expect(timeUntil("2026-11-08T11:00:00Z", now)).toBe("il y a 1 h");
  });
});

describe("Comptes", () => {
  it("normalise les identifiants (accents, espaces, majuscules)", () => {
    expect(normalizeUsername("  Loïc Pirard ")).toBe("loic.pirard");
    expect(usernameToEmail("Loïc Pirard", "x.invalid")).toBe("loic.pirard@x.invalid");
  });
  it("mot de passe temporaire robuste et lisible", () => {
    const a = generateTempPassword();
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(generateTempPassword()).not.toBe(a);
  });
  it("politique de mot de passe", () => {
    expect(validateNewPassword("court1")).toMatch(/8/);
    expect(validateNewPassword("sanschiffre")).toMatch(/chiffre/);
    expect(validateNewPassword("loic.pirard1", "loic.pirard")).toMatch(/identifiant/);
    expect(validateNewPassword("Valide-2026")).toBeNull();
  });
  it("messages d'erreur en français", () => {
    expect(translateError({ message: "VOTE_CLOSED" })).toBe("Le vote est fermé pour ce match.");
    expect(translateError("inconnu")).toBe("Une erreur est survenue. Réessayez.");
  });
});
