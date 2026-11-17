// Logique pure de sélection des trois joueurs (utilisée par l'écran de vote).
export const POINTS_BY_RANK = [3, 2, 1] as const;
export const MAX_PICKS = 3;

export type Selection = string[]; // identifiants de joueurs, dans l'ordre du rang

export type SelectionAction =
  | { type: "toggle"; playerId: string; selfId?: string | null }
  | { type: "move"; index: number; direction: -1 | 1 }
  | { type: "reset" }
  | { type: "set"; selection: Selection };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "toggle": {
      if (action.selfId && action.playerId === action.selfId) return state;
      if (state.includes(action.playerId)) return state.filter((id) => id !== action.playerId);
      if (state.length >= MAX_PICKS) return state;
      return [...state, action.playerId];
    }
    case "move": {
      const target = action.index + action.direction;
      if (action.index < 0 || action.index >= state.length || target < 0 || target >= state.length) {
        return state;
      }
      const next = [...state];
      [next[action.index], next[target]] = [next[target], next[action.index]];
      return next;
    }
    case "reset":
      return [];
    case "set":
      return action.selection.slice(0, MAX_PICKS);
  }
}

export function pointsForRank(rankIndex: number): number {
  return POINTS_BY_RANK[rankIndex] ?? 0;
}

export function isSelectionComplete(selection: Selection, selfId?: string | null): boolean {
  return (
    selection.length === MAX_PICKS &&
    new Set(selection).size === MAX_PICKS &&
    (!selfId || !selection.includes(selfId))
  );
}
