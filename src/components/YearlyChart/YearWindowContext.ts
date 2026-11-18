import { createContext } from "react";

/** The explorer's shared year window; YearlyChart edits it when a provider is present. */
export interface YearWindow {
  /** Full extent of the person's papers. */
  min: number;
  max: number;
  /** Current window (equals [min, max] when unfiltered). */
  lo: number;
  hi: number;
  filtered: boolean;
  onChange: (range: [number, number]) => void;
  onReset: () => void;
}

export const YearWindowContext = createContext<YearWindow | null>(null);
