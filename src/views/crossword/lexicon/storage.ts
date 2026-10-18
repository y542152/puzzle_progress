import localforage from "localforage";
import type { Lexicon, LexiconWord } from "./types";
import { normalizeLexiconWords } from "./words";

const store = localforage.createInstance({
  name: "crossword-lexicons",
  storeName: "items"
});

const KEY = "list";

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function listLexicons(): Promise<Lexicon[]> {
  const list = await store.getItem<Lexicon[]>(KEY);
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveLexicon(input: {
  id?: string;
  name: string;
  words: LexiconWord[];
}): Promise<Lexicon> {
  const name = input.name.trim();
  if (!name || name.length > 64) {
    throw new Error("词库名称须为 1 到 64 个字符");
  }
  const words = normalizeLexiconWords(input.words);
  if (!words.length) throw new Error("词库至少需要一个单词");

  const list = await listLexicons();
  const now = new Date().toISOString();
  if (input.id) {
    const index = list.findIndex(item => item.id === input.id);
    if (index < 0) throw new Error("词库不存在");
    const next: Lexicon = { ...list[index], name, words, updatedAt: now };
    list[index] = next;
    await store.setItem(KEY, list);
    return next;
  }

  const created: Lexicon = {
    id: newId(),
    name,
    words,
    createdAt: now,
    updatedAt: now
  };
  list.unshift(created);
  await store.setItem(KEY, list);
  return created;
}

export async function deleteLexicon(id: string) {
  const list = await listLexicons();
  await store.setItem(
    KEY,
    list.filter(item => item.id !== id)
  );
}
