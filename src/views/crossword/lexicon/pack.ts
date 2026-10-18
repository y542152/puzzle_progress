import type { LexiconWord } from "./types";

export interface Packed {
  word: LexiconWord;
  orientation: "across" | "down";
  row: number;
  col: number;
}

type Direction = "across" | "down";

interface Cell {
  letter: string;
  across: number | null;
  down: number | null;
}

interface Slot {
  index: number;
  row: number;
  col: number;
  orientation: Direction;
  crosses: number;
  groups: number;
}

function emptyGrid(size: number) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null as Cell | null)
  );
}

/** 在已有词的中间另起一词时，前后两段都不能都长到能单独当成一条词。 */
function startsInsideLongSplit(
  grid: (Cell | null)[][],
  row: number,
  col: number,
  orientation: Direction
) {
  const hostAcross = orientation === "down";
  const id = hostAcross ? grid[row][col]?.across : grid[row][col]?.down;
  if (id == null) return false;
  const size = grid.length;
  let start = hostAcross ? col : row;
  let end = start;
  while (start > 0) {
    const nextRow = hostAcross ? row : start - 1;
    const nextCol = hostAcross ? start - 1 : col;
    const mark = hostAcross
      ? grid[nextRow][nextCol]?.across
      : grid[nextRow][nextCol]?.down;
    if (mark !== id) break;
    start -= 1;
  }
  while (end + 1 < size) {
    const nextRow = hostAcross ? row : end + 1;
    const nextCol = hostAcross ? end + 1 : col;
    const mark = hostAcross
      ? grid[nextRow][nextCol]?.across
      : grid[nextRow][nextCol]?.down;
    if (mark !== id) break;
    end += 1;
  }
  const pos = hostAcross ? col : row;
  const before = pos - start;
  const after = end - pos + 1;
  return before >= 5 && after >= 5;
}

function measure(
  grid: (Cell | null)[][],
  word: string,
  row: number,
  col: number,
  orientation: Direction
) {
  const size = grid.length;
  const down = orientation === "down";
  const endRow = down ? row + word.length - 1 : row;
  const endCol = down ? col : col + word.length - 1;
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return null;
  const beforeRow = down ? row - 1 : row;
  const beforeCol = down ? col : col - 1;
  if (
    beforeRow >= 0 &&
    beforeCol >= 0 &&
    beforeRow < size &&
    beforeCol < size &&
    grid[beforeRow][beforeCol]
  ) {
    return null;
  }
  const afterRow = down ? endRow + 1 : endRow;
  const afterCol = down ? endCol : endCol + 1;
  if (
    afterRow >= 0 &&
    afterCol >= 0 &&
    afterRow < size &&
    afterCol < size &&
    grid[afterRow][afterCol]
  ) {
    return null;
  }

  let crosses = 0;
  let fresh = 0;
  let previous = false;
  const groups = new Set<number>();
  for (let i = 0; i < word.length; i += 1) {
    const r = down ? row + i : row;
    const c = down ? col : col + i;
    const cell = grid[r][c];
    if (cell) {
      if (i === 0 && startsInsideLongSplit(grid, r, c, orientation))
        return null;
      if (cell.letter !== word[i] || previous) return null;
      if (orientation === "across" ? cell.across != null : cell.down != null) {
        return null;
      }
      const other = orientation === "across" ? cell.down : cell.across;
      if (other == null) return null;
      previous = true;
      crosses += 1;
      groups.add(other);
      continue;
    }
    previous = false;
    fresh += 1;
    if (orientation === "across") {
      if (r > 0 && grid[r - 1][c]) return null;
      if (r + 1 < size && grid[r + 1][c]) return null;
    } else if (c > 0 && grid[r][c - 1]) return null;
    else if (c + 1 < size && grid[r][c + 1]) return null;
  }
  if (!fresh) return null;
  return { crosses, groups: groups.size };
}

function writeWord(
  grid: (Cell | null)[][],
  word: string,
  row: number,
  col: number,
  orientation: Direction,
  id: number
) {
  const down = orientation === "down";
  for (let i = 0; i < word.length; i += 1) {
    const r = down ? row + i : row;
    const c = down ? col : col + i;
    const current = grid[r][c];
    if (current) {
      if (orientation === "across") current.across = id;
      else current.down = id;
    } else {
      grid[r][c] = {
        letter: word[i],
        across: orientation === "across" ? id : null,
        down: orientation === "down" ? id : null
      };
    }
  }
}

function letterIndex(grid: (Cell | null)[][]) {
  const index = new Map<string, { row: number; col: number }[]>();
  grid.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!cell) return;
      const list = index.get(cell.letter);
      const point = { row, col };
      if (list) list.push(point);
      else index.set(cell.letter, [point]);
    });
  });
  return index;
}

function slotKey(slot: Slot) {
  return `${slot.index}|${slot.row}|${slot.col}|${slot.orientation}`;
}

function candidateSlots(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  mustCross: boolean
) {
  const index = letterIndex(grid);
  const slots: Slot[] = [];
  const seen = new Set<string>();
  words.forEach((word, wordIndex) => {
    if (used[wordIndex]) return;
    const answer = word.answer;
    for (let i = 0; i < answer.length; i += 1) {
      const hits = index.get(answer[i]) || [];
      for (const hit of hits) {
        const options: { row: number; col: number; orientation: Direction }[] =
          [
            { row: hit.row, col: hit.col - i, orientation: "across" },
            { row: hit.row - i, col: hit.col, orientation: "down" }
          ];
        for (const option of options) {
          const fit = measure(
            grid,
            answer,
            option.row,
            option.col,
            option.orientation
          );
          if (!fit || (mustCross && fit.crosses < 1)) continue;
          const slot: Slot = {
            index: wordIndex,
            row: option.row,
            col: option.col,
            orientation: option.orientation,
            crosses: fit.crosses,
            groups: fit.groups
          };
          const key = slotKey(slot);
          if (seen.has(key)) continue;
          seen.add(key);
          slots.push(slot);
        }
      }
    }
  });
  return slots;
}

function bounds(grid: (Cell | null)[][]) {
  let top = grid.length;
  let left = grid.length;
  let bottom = -1;
  let right = -1;
  let filled = 0;
  grid.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!cell) return;
      filled += 1;
      top = Math.min(top, row);
      left = Math.min(left, col);
      bottom = Math.max(bottom, row);
      right = Math.max(right, col);
    });
  });
  const height = bottom < 0 ? 0 : bottom - top + 1;
  const width = right < 0 ? 0 : right - left + 1;
  return { height, width, filled, area: Math.max(height * width, 1) };
}

function slotScore(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  placed: Packed[],
  slot: Slot
) {
  const before = bounds(grid);
  const answer = words[slot.index].answer;
  const down = slot.orientation === "down";
  const endRow = down ? slot.row + answer.length - 1 : slot.row;
  const endCol = down ? slot.col : slot.col + answer.length - 1;
  let top = before.height ? Math.min(slot.row, grid.length) : slot.row;
  let left = before.width ? Math.min(slot.col, grid.length) : slot.col;
  let bottom = endRow;
  let right = endCol;
  grid.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!cell) return;
      top = Math.min(top, row);
      left = Math.min(left, col);
      bottom = Math.max(bottom, row);
      right = Math.max(right, col);
    });
  });
  const height = bottom - top + 1;
  const width = right - left + 1;
  const area = height * width;
  const growth = area - (before.height ? before.area : 0);
  const balance = Math.abs(height - width);
  const across = placed.filter(item => item.orientation === "across").length;
  const downs = placed.length - across;
  const minority =
    (slot.orientation === "across" && across <= downs) ||
    (slot.orientation === "down" && downs <= across)
      ? 12
      : 0;
  return (
    slot.groups * 80 +
    slot.crosses * 18 +
    minority +
    answer.length -
    growth * 12 -
    balance * 4
  );
}

function applySlot(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  placed: Packed[],
  slot: Slot
) {
  const word = words[slot.index];
  writeWord(
    grid,
    word.answer,
    slot.row,
    slot.col,
    slot.orientation,
    placed.length
  );
  placed.push({
    word,
    orientation: slot.orientation,
    row: slot.row,
    col: slot.col
  });
}

function clearWord(grid: (Cell | null)[][], id: number) {
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid.length; col += 1) {
      const cell = grid[row][col];
      if (!cell) continue;
      if (cell.across === id) cell.across = null;
      if (cell.down === id) cell.down = null;
      if (cell.across == null && cell.down == null) grid[row][col] = null;
    }
  }
}

function linksBar(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  id: number
) {
  for (const slot of candidateSlots(grid, words, used, true)) {
    if (slot.orientation !== "down" || slot.groups < 2) continue;
    const answer = words[slot.index].answer;
    for (let i = 0; i < answer.length; i += 1) {
      const cell = grid[slot.row + i]?.[slot.col];
      if (cell && (cell.across === id || cell.down === id)) return true;
    }
  }
  return false;
}

function fillRest(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  placed: Packed[]
) {
  let open = true;
  while (open) {
    open = false;
    const slots = candidateSlots(grid, words, used, true);
    if (!slots.length) break;
    let best = slots[0];
    let bestScore = slotScore(grid, words, placed, best);
    for (const slot of slots.slice(1)) {
      const score = slotScore(grid, words, placed, slot);
      if (
        score > bestScore ||
        (score === bestScore &&
          words[slot.index].answer.length > words[best.index].answer.length)
      ) {
        best = slot;
        bestScore = score;
      }
    }
    applySlot(grid, words, placed, best);
    used[best.index] = true;
    open = true;
  }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.map(item => item)];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = items.filter((_, itemIndex) => itemIndex !== index);
    for (const next of permutations(rest)) out.push([item, ...next]);
  });
  return out;
}

function barOrders(
  pool: { index: number }[],
  size: number,
  words: LexiconWord[]
) {
  const width = pool.map(item =>
    Math.min(2, size - words[item.index].answer.length + 1)
  );
  const product = width.reduce((total, count) => total * count, 1);
  const factorial = [1, 1, 2, 6, 24, 120, 720];
  if (pool.length <= 6 && factorial[pool.length] * product <= 800) {
    return permutations(pool);
  }
  return pool.map((item, index) => [
    item,
    ...pool.filter((_, itemIndex) => itemIndex !== index)
  ]);
}

function columnsFor(length: number, size: number) {
  const last = size - length;
  const all = Array.from({ length: last + 1 }, (_, col) => col);
  if (all.length <= 2) return all;
  return all.filter(col => col <= 1);
}

/** 长词隔行横放，并试不同的左右对齐，让短词能同时穿过多条横条。 */
function growLayered(words: LexiconWord[], size: number) {
  const ranked = words
    .map((word, index) => ({ index, length: word.answer.length }))
    .filter(item => item.length >= 4)
    .sort(
      (a, b) =>
        b.length - a.length ||
        words[a.index].answer.localeCompare(words[b.index].answer)
    );
  if (ranked.length < 2) return [];
  const floor = Math.max(4, ranked[0].length - 1);
  const rows: number[] = [];
  for (let row = 0; row < size; row += 2) rows.push(row);
  const pool = ranked
    .filter(item => item.length >= floor)
    .slice(0, rows.length);
  if (pool.length < 2) return [];

  let best: Packed[] = [];
  let bestScore = -1;
  let seen = 0;
  const consider = (
    grid: (Cell | null)[][],
    used: boolean[],
    placed: Packed[]
  ) => {
    if (placed.length < 2) return;
    const trialUsed = used.slice();
    const trialPlaced = placed.map(item => ({ ...item, word: item.word }));
    const trialGrid = grid.map(line =>
      line.map(cell => (cell ? { ...cell } : null))
    );
    fillOpenRows(trialGrid, words, trialUsed, trialPlaced, size);
    fillRest(trialGrid, words, trialUsed, trialPlaced);
    const kept = largestPacked(trialPlaced);
    const score = packScore(kept);
    if (score > bestScore) {
      best = kept;
      bestScore = score;
    }
  };

  for (const order of barOrders(pool, size, words)) {
    const startLimit = Math.min(1, rows.length - order.length);
    for (let start = 0; start <= startLimit; start += 1) {
      const grid = emptyGrid(size);
      const used = words.map(() => false);
      const placed: Packed[] = [];
      const walk = (depth: number) => {
        if (seen > 900) return;
        const row = rows[start + depth];
        if (depth >= order.length || row == null) {
          seen += 1;
          consider(grid, used, placed);
          return;
        }
        const item = order[depth];
        const answer = words[item.index].answer;
        let placedOne = false;
        for (const col of columnsFor(answer.length, size)) {
          if (!measure(grid, answer, row, col, "across")) continue;
          applySlot(grid, words, placed, {
            index: item.index,
            row,
            col,
            orientation: "across",
            crosses: 0,
            groups: 0
          });
          used[item.index] = true;
          const linked =
            depth === 0 || linksBar(grid, words, used, placed.length - 1);
          if (linked) {
            placedOne = true;
            walk(depth + 1);
          }
          used[item.index] = false;
          clearWord(grid, placed.length - 1);
          placed.pop();
        }
        if (!placedOne) {
          seen += 1;
          consider(grid, used, placed);
        }
      };
      walk(0);
    }
  }
  return best;
}

function cheapLinks(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  row: number,
  col: number,
  answer: string
) {
  const size = grid.length;
  let count = 0;
  words.forEach((word, index) => {
    if (used[index]) return;
    const down = word.answer;
    for (let i = 0; i < answer.length; i += 1) {
      const column = col + i;
      for (let j = 0; j < down.length; j += 1) {
        if (down[j] !== answer[i]) continue;
        const start = row - j;
        if (start < 0 || start + down.length > size) continue;
        let groups = 1;
        for (let k = 0; k < down.length; k += 1) {
          if (k === j) continue;
          if (grid[start + k][column]?.letter === down[k]) groups += 1;
        }
        if (groups >= 2) {
          count += 1;
          return;
        }
      }
    }
  });
  return count;
}

function planOpenRow(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  row: number
) {
  const size = grid.length;
  const candidates: { index: number; col: number; links: number }[] = [];
  words.forEach((word, index) => {
    if (used[index] || word.answer.length < 3) return;
    for (let col = 0; col <= size - word.answer.length; col += 1) {
      if (!measure(grid, word.answer, row, col, "across")) continue;
      const links = cheapLinks(grid, words, used, row, col, word.answer);
      if (links < 1) continue;
      candidates.push({ index, col, links });
    }
  });
  const plans: { slots: { index: number; col: number }[]; score: number }[] =
    [];
  candidates.forEach(slot => {
    const length = words[slot.index].answer.length;
    plans.push({
      slots: [slot],
      score: length * 10 + slot.links
    });
    candidates.forEach(other => {
      if (other.index === slot.index || other.index < slot.index) return;
      const otherLength = words[other.index].answer.length;
      const gap =
        slot.col <= other.col
          ? other.col - (slot.col + length)
          : slot.col - (other.col + otherLength);
      if (gap < 1) return;
      plans.push({
        slots: [slot, other],
        score: (length + otherLength) * 10 + slot.links + other.links
      });
    });
  });
  plans.sort((a, b) => b.score - a.score || a.slots.length - b.slots.length);
  for (const plan of plans.slice(0, 8)) {
    if (!rowLinks(grid, words, used, row, plan.slots)) continue;
    return plan.slots.map(slot => ({
      index: slot.index,
      row,
      col: slot.col,
      orientation: "across" as Direction,
      crosses: 0,
      groups: 0
    }));
  }
  return [];
}

function rowLinks(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  row: number,
  slots: { index: number; col: number }[]
) {
  const touched: { r: number; c: number; prev: Cell | null }[] = [];
  slots.forEach((slot, offset) => {
    const answer = words[slot.index].answer;
    for (let i = 0; i < answer.length; i += 1) {
      const cell = grid[row][slot.col + i];
      touched.push({
        r: row,
        c: slot.col + i,
        prev: cell ? { ...cell } : null
      });
    }
    writeWord(grid, answer, row, slot.col, "across", 900 + offset);
    used[slot.index] = true;
  });
  const linked = slots.every((_, offset) =>
    linksBar(grid, words, used, 900 + offset)
  );
  slots.forEach(slot => {
    used[slot.index] = false;
  });
  for (const cell of touched) grid[cell.r][cell.c] = cell.prev;
  return linked;
}

function largestPacked(placed: Packed[]) {
  const cells = placed.map(item => {
    const keys = new Set<string>();
    const down = item.orientation === "down";
    for (let i = 0; i < item.word.answer.length; i += 1) {
      const row = down ? item.row + i : item.row;
      const col = down ? item.col : item.col + i;
      keys.add(`${row},${col}`);
    }
    return keys;
  });
  const neighbors = placed.map(() => [] as number[]);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      for (const key of cells[i]) {
        if (!cells[j].has(key)) continue;
        neighbors[i].push(j);
        neighbors[j].push(i);
        break;
      }
    }
  }
  const seen = new Set<number>();
  let best: number[] = [];
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
    if (component.length > best.length) best = component;
  }
  return best.map(index => placed[index]);
}

function fillOpenRows(
  grid: (Cell | null)[][],
  words: LexiconWord[],
  used: boolean[],
  placed: Packed[],
  size: number
) {
  const anchored = new Set<number>();
  grid.forEach((line, row) => {
    if (line.some(cell => cell)) anchored.add(row);
  });
  for (let row = 0; row < size; row += 2) {
    if (anchored.has(row)) continue;
    if (!anchored.has(row - 2) && !anchored.has(row + 2)) continue;
    for (const slot of planOpenRow(grid, words, used, row)) {
      applySlot(grid, words, placed, slot);
      used[slot.index] = true;
    }
  }
}

function grow(
  words: LexiconWord[],
  size: number,
  seed: { index: number; row: number; col: number; orientation: Direction }
) {
  const grid = emptyGrid(size);
  const used = words.map(() => false);
  const placed: Packed[] = [];
  const seedWord = words[seed.index].answer;
  if (!measure(grid, seedWord, seed.row, seed.col, seed.orientation)) {
    return placed;
  }
  writeWord(grid, seedWord, seed.row, seed.col, seed.orientation, 0);
  placed.push({
    word: words[seed.index],
    orientation: seed.orientation,
    row: seed.row,
    col: seed.col
  });
  used[seed.index] = true;
  fillRest(grid, words, used, placed);
  return placed;
}

export function packScore(placed: Packed[]) {
  if (!placed.length) return -1;
  const rows = new Set<number>();
  const cols = new Set<number>();
  const owners = new Map<string, number>();
  let crosses = 0;
  for (const item of placed) {
    const down = item.orientation === "down";
    for (let i = 0; i < item.word.answer.length; i += 1) {
      const row = down ? item.row + i : item.row;
      const col = down ? item.col : item.col + i;
      rows.add(row);
      cols.add(col);
      const key = `${row},${col}`;
      const count = owners.get(key) || 0;
      if (count === 1) crosses += 1;
      owners.set(key, count + 1);
    }
  }
  const height = rows.size;
  const width = cols.size;
  const area = Math.max(height * width, 1);
  const density = owners.size / area;
  return (
    placed.length * 10000 +
    density * 1000 +
    crosses * 5 -
    Math.abs(height - width) * 20
  );
}

/** 在边长内尽量排成互相穿插的密盘，多试几种起点后取更整齐的一盘。 */
export function packDense(words: LexiconWord[], size: number) {
  if (words.length < 2 || size < 2) return [];
  const order = words
    .map((word, index) => ({ word, index }))
    .sort(
      (a, b) =>
        b.word.answer.length - a.word.answer.length ||
        a.word.answer.localeCompare(b.word.answer)
    );
  let best: Packed[] = [];
  let bestScore = -1;
  const layered = growLayered(words, size);
  best = layered;
  bestScore = packScore(layered);
  for (const seedWord of order.slice(0, 4)) {
    const len = seedWord.word.answer.length;
    const centered = Math.floor((size - len) / 2);
    const mid = Math.floor((size - 1) / 2);
    const seeds: {
      index: number;
      row: number;
      col: number;
      orientation: Direction;
    }[] = [
      { index: seedWord.index, row: 0, col: centered, orientation: "across" },
      { index: seedWord.index, row: mid, col: centered, orientation: "across" },
      { index: seedWord.index, row: centered, col: mid, orientation: "down" }
    ];
    for (const seed of seeds) {
      const placed = grow(words, size, seed);
      const score = packScore(placed);
      if (score > bestScore) {
        best = placed;
        bestScore = score;
      }
    }
  }
  return best;
}
