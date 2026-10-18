export type LexiconLevel = "easy" | "normal" | "hard";

export interface LexiconWord {
  answer: string;
  clue: string;
}

export interface Lexicon {
  id: string;
  name: string;
  words: LexiconWord[];
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedClue {
  direction: "across" | "down";
  number: number;
  clue: string;
  answer: string;
  row: number;
  col: number;
}
