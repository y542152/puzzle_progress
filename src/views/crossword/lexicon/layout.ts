import { generateLayout, type LayoutResult } from "crossword-layout-generator";
import { packDense, packScore } from "./pack";
import type { GeneratedClue, LexiconWord } from "./types";

export interface LayoutOutcome {
  clues: GeneratedClue[];
  dropped: string[];
  /** 去掉空行、空列后的边长 */
  size: number;
}

interface Placed {
  word: LexiconWord;
  orientation: "across" | "down";
  row: number;
  col: number;
}

function runLayout(words: LexiconWord[]): LayoutResult {
  const log = console.log;
  console.log = () => undefined;
  try {
    return generateLayout(
      words.map(word => ({
        answer: word.answer.toLowerCase(),
        clue: word.clue
      }))
    );
  } finally {
    console.log = log;
  }
}

function placedWords(layout: LayoutResult, source: Map<string, LexiconWord>) {
  const placed: Placed[] = [];
  for (const item of layout.result) {
    if (item.orientation !== "across" && item.orientation !== "down") continue;
    if (item.startx == null || item.starty == null) continue;
    const word = source.get(item.answer.toLowerCase());
    if (!word) continue;
    placed.push({
      word,
      orientation: item.orientation,
      row: item.starty - 1,
      col: item.startx - 1
    });
  }
  return placed;
}

function wordEnd(item: Placed) {
  return {
    row:
      item.orientation === "down"
        ? item.row + item.word.answer.length - 1
        : item.row,
    col:
      item.orientation === "across"
        ? item.col + item.word.answer.length - 1
        : item.col
  };
}

function insideWindow(item: Placed, top: number, left: number, size: number) {
  const end = wordEnd(item);
  return (
    item.row >= top &&
    item.col >= left &&
    end.row < top + size &&
    end.col < left + size
  );
}

function cellKeys(item: Placed) {
  const keys: string[] = [];
  for (let i = 0; i < item.word.answer.length; i += 1) {
    const row = item.orientation === "down" ? item.row + i : item.row;
    const col = item.orientation === "across" ? item.col + i : item.col;
    keys.push(`${row},${col}`);
  }
  return keys;
}

/** 只保留彼此有交叉的最大一组。字母数用来打破单词数相同的平局。 */
function largestComponent(placed: Placed[]) {
  const owners = new Map<string, number[]>();
  placed.forEach((item, index) => {
    for (const key of cellKeys(item)) {
      const list = owners.get(key);
      if (list) list.push(index);
      else owners.set(key, [index]);
    }
  });
  const neighbors = placed.map(() => [] as number[]);
  for (const list of owners.values()) {
    for (let i = 1; i < list.length; i += 1) {
      neighbors[list[0]].push(list[i]);
      neighbors[list[i]].push(list[0]);
    }
  }
  const seen = new Set<number>();
  let best: number[] = [];
  let letters = -1;
  for (let start = 0; start < placed.length; start += 1) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component: number[] = [];
    seen.add(start);
    while (stack.length) {
      const current = stack.pop() as number;
      component.push(current);
      for (const next of neighbors[current]) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    const nextLetters = component.reduce(
      (sum, index) => sum + placed[index].word.answer.length,
      0
    );
    if (
      component.length > best.length ||
      (component.length === best.length && nextLetters > letters)
    ) {
      best = component;
      letters = nextLetters;
    }
  }
  return best.map(index => placed[index]);
}

function bestWindow(
  placed: Placed[],
  size: number,
  rows: number,
  cols: number
) {
  const maxTop = Math.max(0, rows - size);
  const maxLeft = Math.max(0, cols - size);
  let top = 0;
  let left = 0;
  let inside: Placed[] = [];
  let letters = -1;
  for (let y = 0; y <= maxTop; y += 1) {
    for (let x = 0; x <= maxLeft; x += 1) {
      const next = largestComponent(
        placed.filter(item => insideWindow(item, y, x, size))
      );
      const nextLetters = next.reduce(
        (sum, item) => sum + item.word.answer.length,
        0
      );
      if (
        next.length > inside.length ||
        (next.length === inside.length && nextLetters > letters)
      ) {
        inside = next;
        letters = nextLetters;
        top = y;
        left = x;
      }
    }
  }
  return { top, left, inside };
}

function toClues(placed: Placed[]): GeneratedClue[] {
  const keys = [...new Set(placed.map(item => `${item.row},${item.col}`))].sort(
    (a, b) => {
      const [ar, ac] = a.split(",").map(Number);
      const [br, bc] = b.split(",").map(Number);
      return ar - br || ac - bc;
    }
  );
  const numbers = new Map(keys.map((key, index) => [key, index + 1]));
  return placed
    .map(item => ({
      direction: item.orientation,
      number: numbers.get(`${item.row},${item.col}`) || 1,
      clue: item.word.clue,
      answer: item.word.answer,
      row: item.row,
      col: item.col
    }))
    .sort(
      (a, b) =>
        a.number - b.number ||
        (a.direction === b.direction ? 0 : a.direction === "across" ? -1 : 1)
    );
}

/** 同一行（或同一列）上相邻两条词之间，至少留一格黑格，避免收成一个更长的词。 */
function separatorGaps(placed: Placed[], orientation: "across" | "down") {
  const groups = new Map<number, Placed[]>();
  for (const item of placed) {
    if (item.orientation !== orientation) continue;
    const key = orientation === "across" ? item.row : item.col;
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  const gaps: number[][] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) =>
      orientation === "across" ? a.col - b.col : a.row - b.row
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      const prevEnd =
        (orientation === "across" ? prev.col : prev.row) +
        prev.word.answer.length -
        1;
      const nextStart = orientation === "across" ? next.col : next.row;
      if (nextStart <= prevEnd + 1) continue;
      const gap: number[] = [];
      for (let index = prevEnd + 1; index < nextStart; index += 1) {
        gap.push(index);
      }
      gaps.push(gap);
    }
  }
  return gaps;
}

/** 删掉整行、整列空白，再放进能包住内容的方盘。高宽不同时把较短的一边居中。 */
function tighten(placed: Placed[]) {
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const item of placed) {
    for (const key of cellKeys(item)) {
      const [row, col] = key.split(",").map(Number);
      rows.add(row);
      cols.add(col);
    }
  }
  for (const gap of separatorGaps(placed, "across")) {
    if (gap.some(col => cols.has(col))) continue;
    cols.add(gap[0]);
  }
  for (const gap of separatorGaps(placed, "down")) {
    if (gap.some(row => rows.has(row))) continue;
    rows.add(gap[0]);
  }
  const rowList = [...rows].sort((a, b) => a - b);
  const colList = [...cols].sort((a, b) => a - b);
  const rowAt = new Map(rowList.map((row, index) => [row, index]));
  const colAt = new Map(colList.map((col, index) => [col, index]));
  const height = rowList.length || 1;
  const width = colList.length || 1;
  const size = Math.max(height, width);
  const rowPad = Math.floor((size - height) / 2);
  const colPad = Math.floor((size - width) / 2);
  return {
    size,
    placed: placed.map(item => ({
      ...item,
      row: (rowAt.get(item.row) ?? 0) + rowPad,
      col: (colAt.get(item.col) ?? 0) + colPad
    }))
  };
}

interface Tight {
  size: number;
  placed: Placed[];
}

/** 去掉从长词中段另起、把前后都切成能单独成词的那一条。 */
function dropLongSplits(placed: Placed[]) {
  const blocked = new Set<Placed>();
  for (const host of placed) {
    const across = host.orientation === "across";
    for (const other of placed) {
      if (other.orientation === host.orientation) continue;
      const before = across ? other.col - host.col : other.row - host.row;
      const aligned = across ? other.row === host.row : other.col === host.col;
      if (!aligned || before < 5) continue;
      const after = host.word.answer.length - before;
      if (after >= 5) blocked.add(other);
    }
  }
  if (!blocked.size) return placed;
  return placed.filter(item => !blocked.has(item));
}

/** 裁进方盘、只留最大连通块，再去掉空行空列。用户最终看到的就是这一步的结果。 */
function settle(placed: Placed[], size: number, rows: number, cols: number) {
  if (placed.length < 2) return null;
  const window = bestWindow(placed, size, rows, cols);
  if (window.inside.length < 2) return null;
  const shifted = window.inside.map(item => ({
    ...item,
    row: item.row - window.top,
    col: item.col - window.left
  }));
  return tighten(shifted);
}

/** 把选中的单词排进 size×size。排不进方盘、或和主盘面没有交叉的答案放在 dropped。 */
export function layoutIntoSquare(
  words: LexiconWord[],
  size: number
): LayoutOutcome {
  const grid = Math.floor(Number(size));
  const dropped: string[] = [];
  const usable: LexiconWord[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    const answer = word.answer.trim().toUpperCase();
    if (!answer || seen.has(answer)) continue;
    seen.add(answer);
    if (!/^[A-Z]{2,32}$/.test(answer) || answer.length > grid || grid < 2) {
      dropped.push(answer);
      continue;
    }
    usable.push({ answer, clue: word.clue.trim() });
  }

  if (!usable.length) return { clues: [], dropped, size: grid };
  if (usable.length === 1) {
    const packed = tighten([
      {
        word: usable[0],
        orientation: "across",
        row: 0,
        col: 0
      }
    ]);
    return { clues: toClues(packed.placed), dropped, size: packed.size };
  }

  const source = new Map(usable.map(word => [word.answer.toLowerCase(), word]));
  const longest = usable.reduce(
    (max, word) => Math.max(max, word.answer.length),
    0
  );
  const spans = longest >= 2 && longest < grid ? [grid, longest] : [grid];
  let packed = packDense(usable, spans[0]);
  let packedScore = packScore(packed);
  for (const span of spans.slice(1)) {
    const next = packDense(usable, span);
    const score = packScore(next);
    if (score > packedScore) {
      packed = next;
      packedScore = score;
    }
  }
  const layout = runLayout(usable);
  const generated = dropLongSplits(placedWords(layout, source));
  packed = dropLongSplits(packed);
  const boards = [
    settle(packed, grid, grid, grid),
    settle(
      generated,
      grid,
      Math.max(layout.rows, grid),
      Math.max(layout.cols, grid)
    )
  ].filter((board): board is Tight => board != null);
  boards.sort(
    (a, b) => packScore(b.placed) - packScore(a.placed) || a.size - b.size
  );
  const chosen = boards[0];
  if (!chosen) {
    return {
      clues: [],
      dropped: [...dropped, ...usable.map(word => word.answer)],
      size: grid
    };
  }

  const kept = new Set(chosen.placed.map(item => item.word.answer));
  for (const word of usable) {
    if (!kept.has(word.answer)) dropped.push(word.answer);
  }
  return {
    clues: toClues(chosen.placed),
    size: chosen.size,
    dropped
  };
}
