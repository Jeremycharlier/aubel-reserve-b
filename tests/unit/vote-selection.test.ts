import { describe, it, expect } from "vitest";
import { isSelectionComplete, pointsForRank, selectionReducer } from "@/lib/vote-selection";

describe("Sélection des trois joueurs (écran de vote)", () => {
  it("1er clic = 3 pts, 2e = 2 pts, 3e = 1 pt", () => {
    let s = selectionReducer([], { type: "toggle", playerId: "a" });
    s = selectionReducer(s, { type: "toggle", playerId: "b" });
    s = selectionReducer(s, { type: "toggle", playerId: "c" });
    expect(s).toEqual(["a", "b", "c"]);
    expect(s.map((_, i) => pointsForRank(i))).toEqual([3, 2, 1]);
  });

  it("pas de quatrième choix", () => {
    const s = selectionReducer(["a", "b", "c"], { type: "toggle", playerId: "d" });
    expect(s).toEqual(["a", "b", "c"]);
  });

  it("retirer un joueur fait remonter les suivants", () => {
    expect(selectionReducer(["a", "b", "c"], { type: "toggle", playerId: "a" })).toEqual(["b", "c"]);
  });

  it("impossible de se choisir soi-même", () => {
    expect(selectionReducer([], { type: "toggle", playerId: "moi", selfId: "moi" })).toEqual([]);
    expect(isSelectionComplete(["a", "b", "moi"], "moi")).toBe(false);
  });

  it("modifier l'ordre", () => {
    expect(selectionReducer(["a", "b", "c"], { type: "move", index: 2, direction: -1 })).toEqual(["a", "c", "b"]);
    expect(selectionReducer(["a", "b", "c"], { type: "move", index: 0, direction: -1 })).toEqual(["a", "b", "c"]);
  });

  it("recommencer", () => {
    expect(selectionReducer(["a", "b"], { type: "reset" })).toEqual([]);
  });

  it("validation seulement avec trois joueurs distincts", () => {
    expect(isSelectionComplete(["a", "b"])).toBe(false);
    expect(isSelectionComplete(["a", "a", "b"])).toBe(false);
    expect(isSelectionComplete(["a", "b", "c"])).toBe(true);
  });
});
