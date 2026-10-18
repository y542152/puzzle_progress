declare module "crossword-layout-generator" {
  export interface LayoutWord {
    answer: string;
    clue?: string;
    startx?: number;
    starty?: number;
    position?: number;
    orientation?: "across" | "down" | "none";
  }

  export interface LayoutResult {
    rows: number;
    cols: number;
    table: string[][];
    table_string: string;
    result: LayoutWord[];
  }

  export function generateLayout(words: LayoutWord[]): LayoutResult;
}
