import type { LexiconLevel, LexiconWord } from "./types";
import { LEXICON_LEVELS, sanitizeGeneratedWords } from "./words";

const KEY = "crossword-deepseek-key";
const ENDPOINT = "https://api.deepseek.com/chat/completions";

export function getDeepseekKey() {
  return localStorage.getItem(KEY) || "";
}

export function setDeepseekKey(key: string) {
  const value = key.trim();
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}

function parseModelJson(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(trimmed);
}

async function completeJson(input: {
  apiKey: string;
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
  emptyMessage: string;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      signal: input.signal
        ? AbortSignal.any([AbortSignal.timeout(45000), input.signal])
        : AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: input.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      })
    });
  } catch {
    if (input.signal?.aborted) throw new Error("已停止");
    throw new Error("无法连接 DeepSeek");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error
        ? String(body.error.message)
        : "";
    throw new Error(msg || `DeepSeek 请求失败（${response.status}）`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(input.emptyMessage);
  }
  try {
    return parseModelJson(content);
  } catch {
    throw new Error("DeepSeek 返回的内容不是 JSON");
  }
}

function chineseClue(answer: string, clue: string) {
  const text = clue.trim();
  if (!text || text.length > 512) return "";
  if (text.toUpperCase().includes(answer)) return "";
  if (!/[\u4e00-\u9fff]/.test(text)) return "";
  return text;
}

/** 给已有英文答案补中文线索，对不上的答案丢掉 */
export function matchChineseClues(
  raw: unknown,
  answers: string[]
): { clues: { answer: string; clue: string }[]; skipped: number } {
  const wanted = new Map(
    answers.map(answer => [
      answer.trim().toUpperCase(),
      answer.trim().toUpperCase()
    ])
  );
  const list =
    raw && typeof raw === "object" && "clues" in raw
      ? (raw as { clues: unknown }).clues
      : raw;
  const rows = Array.isArray(list) ? list : [];
  const clues: { answer: string; clue: string }[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const answer = String(row.answer ?? "")
      .trim()
      .toUpperCase();
    if (!wanted.has(answer)) continue;
    const clue = chineseClue(answer, String(row.clue ?? ""));
    if (!clue) continue;
    wanted.delete(answer);
    clues.push({ answer, clue });
  }
  return { clues, skipped: wanted.size };
}

export async function generateWordsByDeepseek(input: {
  apiKey: string;
  topic: string;
  count: number;
  minLength: number;
  maxLength: number;
  level: LexiconLevel;
  exclude?: string[];
  signal?: AbortSignal;
}): Promise<{ words: LexiconWord[]; skipped: number }> {
  const level =
    LEXICON_LEVELS.find(item => item.value === input.level) ||
    LEXICON_LEVELS[1];
  const exclude = [
    ...new Set(
      (input.exclude || [])
        .map(answer => answer.trim().toUpperCase())
        .filter(answer => /^[A-Z]{2,32}$/.test(answer))
    )
  ];
  const parsed = await completeJson({
    apiKey: input.apiKey,
    temperature: 0.7,
    signal: input.signal,
    emptyMessage: "DeepSeek 没有返回词库",
    system:
      "You create English crossword entries. Reply with JSON only, no markdown.",
    user: [
      `Topic: ${input.topic}`,
      `Difficulty: ${level.hint}`,
      'Return {"words":[{"answer":"APPLE","clue":"A round fruit"}]}',
      `Produce exactly ${input.count} items.`,
      `Each answer is one English word, letters A-Z only, length ${input.minLength} to ${input.maxLength}.`,
      "Answers must be unique. No spaces, hyphens, or digits.",
      "Each clue is a short English definition and must not contain the answer.",
      "Choose words that share letters so they can cross in a crossword.",
      exclude.length
        ? `Do not reuse these answers: ${exclude.slice(0, 200).join(", ")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n")
  });
  const raw =
    parsed && typeof parsed === "object" && "words" in parsed
      ? (parsed as { words: unknown }).words
      : null;
  const { words, skipped } = sanitizeGeneratedWords(
    raw,
    input.minLength,
    input.maxLength
  );
  if (!words.length) throw new Error("DeepSeek 没有返回可用的英语单词和线索");
  const banned = new Set(exclude);
  const fresh = words.filter(word => !banned.has(word.answer));
  return {
    words: fresh,
    skipped: skipped + words.length - fresh.length
  };
}

/** 按已有答案批量生成中文线索，一次最多 30 个 */
export async function fillChineseCluesByDeepseek(input: {
  apiKey: string;
  answers: string[];
  signal?: AbortSignal;
}): Promise<{ clues: { answer: string; clue: string }[]; skipped: number }> {
  const answers = [
    ...new Set(
      input.answers
        .map(answer => answer.trim().toUpperCase())
        .filter(answer => /^[A-Z]{2,32}$/.test(answer))
    )
  ];
  if (!answers.length) throw new Error("没有可以填充线索的英文答案");
  const clues: { answer: string; clue: string }[] = [];
  let skipped = 0;
  for (let start = 0; start < answers.length; start += 30) {
    const chunk = answers.slice(start, start + 30);
    let parsed: unknown;
    try {
      parsed = await completeJson({
        apiKey: input.apiKey,
        temperature: 0.4,
        signal: input.signal,
        emptyMessage: "DeepSeek 没有返回线索",
        system: "你为英语字谜写中文线索。只返回 JSON，不要 Markdown。",
        user: [
          '返回 {"clues":[{"answer":"PIG","clue":"农场里常见的家畜"}]}',
          "每条线索是简短中文释义，适合作为字谜提示。",
          "不要包含英文答案，也不要写拼音。",
          "answer 必须与给定单词完全一致，每个单词一条。",
          `Answers: ${chunk.join(", ")}`
        ].join("\n")
      });
    } catch (error) {
      if (!clues.length) throw error;
      skipped += answers.length - start;
      break;
    }
    const matched = matchChineseClues(parsed, chunk);
    clues.push(...matched.clues);
    skipped += matched.skipped;
  }
  if (!clues.length) throw new Error("DeepSeek 没有返回可用的中文线索");
  return { clues, skipped };
}
