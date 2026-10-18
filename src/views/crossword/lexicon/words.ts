import type { LexiconLevel, LexiconWord } from "./types";

export const LEXICON_LEVELS: {
  value: LexiconLevel;
  label: string;
  hint: string;
}[] = [
  {
    value: "easy",
    label: "简单词汇",
    hint: "common everyday words a beginner knows"
  },
  {
    value: "normal",
    label: "中级",
    hint: "intermediate vocabulary"
  },
  {
    value: "hard",
    label: "较难",
    hint: "advanced but fair vocabulary, still real English words"
  }
];

export function normalizeLexiconWords(
  words: { answer: string; clue: string }[]
): LexiconWord[] {
  const seen = new Set<string>();
  return words.map((word, index) => {
    const at = index + 1;
    const answer = word.answer.trim().toUpperCase();
    const clue = word.clue.trim();
    if (!/^[A-Z]{2,32}$/.test(answer)) {
      const shown = word.answer.trim() || "空";
      throw new Error(`第 ${at} 个答案「${shown}」须为 2 到 32 个英文字母`);
    }
    if (clue.length > 512) {
      throw new Error(`第 ${at} 个线索不能超过 512 个字符`);
    }
    if (seen.has(answer)) {
      throw new Error(`答案 ${answer} 重复`);
    }
    seen.add(answer);
    return { answer, clue };
  });
}

export function parseLexiconJson(text: string): {
  name: string;
  words: LexiconWord[];
} {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("JSON 无法解析");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("词库文件须为对象，包含 name 和 words");
  }
  const record = data as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error("缺少词库名称 name");
  }
  if (record.name.trim().length > 64) {
    throw new Error("词库名称不能超过 64 个字符");
  }
  if (!Array.isArray(record.words)) {
    throw new Error("words 须为数组");
  }
  const words = record.words.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个单词格式不正确`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.answer !== "string" || typeof row.clue !== "string") {
      throw new Error(`第 ${index + 1} 个单词须包含字符串 answer 和 clue`);
    }
    return { answer: row.answer, clue: row.clue };
  });
  return {
    name: record.name.trim(),
    words: normalizeLexiconWords(words)
  };
}

/** 按逗号分隔，支持引号和引号内的逗号、换行 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some(item => item.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(item => item.trim())) rows.push(row);
  }
  return rows;
}

/** 词表里的空格、连字符、斜杠等去掉，只留下能进字谜的字母 */
function toCrosswordAnswer(raw: string) {
  const text = raw.normalize("NFKC").trim();
  const parts = text
    .split(/[/／|、;；]/)
    .map(part => part.trim())
    .filter(Boolean);
  const candidates = parts.length > 1 ? [...parts, text] : [text];
  let fallback = "";
  for (const part of candidates) {
    const answer = part.toUpperCase().replace(/[^A-Z]/g, "");
    if (/^[A-Z]{2,32}$/.test(answer)) return answer;
    if (!fallback) fallback = answer;
  }
  return fallback;
}

/** 只读取表头为「单词」的那一列，线索留空 */
export function parseLexiconCsv(
  text: string,
  name: string
): { name: string; words: LexiconWord[] } {
  const lexiconName = name.trim();
  if (!lexiconName || lexiconName.length > 64) {
    throw new Error("词库名称须为 1 到 64 个字符");
  }
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV 是空的");
  const header = rows[0].map(item => item.trim());
  const index = header.indexOf("单词");
  if (index < 0) throw new Error("CSV 须包含「单词」列");
  const words: { answer: string; clue: string }[] = [];
  let count = 0;
  for (const row of rows.slice(1)) {
    const raw = (row[index] || "").trim();
    if (!raw) continue;
    count += 1;
    const answer = toCrosswordAnswer(raw);
    if (!/^[A-Z]{2,32}$/.test(answer)) {
      throw new Error(`第 ${count} 个单词「${raw}」须为 2 到 32 个英文字母`);
    }
    words.push({ answer, clue: "" });
  }
  if (!words.length) throw new Error("「单词」列没有内容");
  return {
    name: lexiconName,
    words: normalizeLexiconWords(words)
  };
}

/** DeepSeek 返回的条目里，丢掉不合规则的，保留能进词库的 */
export function sanitizeGeneratedWords(
  raw: unknown,
  minLength: number,
  maxLength: number
): { words: LexiconWord[]; skipped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const words: LexiconWord[] = [];
  let skipped = 0;
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      skipped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const answer = String(row.answer ?? "")
      .trim()
      .toUpperCase();
    const clue = String(row.clue ?? "").trim();
    const valid =
      /^[A-Z]{2,32}$/.test(answer) &&
      answer.length >= minLength &&
      answer.length <= maxLength &&
      clue.length > 0 &&
      clue.length <= 512 &&
      !seen.has(answer);
    if (!valid) {
      skipped += 1;
      continue;
    }
    seen.add(answer);
    words.push({ answer, clue });
  }
  return { words, skipped };
}
