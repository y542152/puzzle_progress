import axios, { type AxiosRequestConfig } from "axios";
import { message } from "@/utils/message";

const TOKEN_KEY = "crossword-console-token";

export type Direction = "across" | "down";
export type Difficulty = "easy" | "normal" | "hard";
export type PuzzleStatus = 0 | 1 | 2;

export interface ClueWrite {
  direction: Direction;
  number: number;
  clue: string;
  answer: string;
  row: number;
  col: number;
}

export interface Clue extends ClueWrite {
  id: number;
  length: number;
}

export interface PuzzleSummary {
  id: number;
  code: string;
  size: number;
  status: PuzzleStatus;
  clueCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Puzzle extends PuzzleSummary {
  clues?: Clue[];
}

export interface PuzzleWrite {
  code: string;
  size: number;
  status?: PuzzleStatus;
  clues?: ClueWrite[];
}

export interface PuzzleList {
  list: PuzzleSummary[];
  total: number;
}

export interface LevelWrite {
  level?: number;
  puzzleId: number;
  title: string;
  difficulty: Difficulty;
  hintsLimit?: number;
}

export interface Level {
  level: number;
  puzzleId: number;
  puzzleCode: string;
  puzzleStatus: PuzzleStatus;
  size: number;
  title: string;
  difficulty: Difficulty;
  hintsLimit: number;
}

export interface DailyWrite {
  date?: string;
  puzzleId: number;
  title: string;
  hintsLimit?: number;
}

export interface Daily {
  date: string;
  puzzleId: number;
  puzzleCode: string;
  puzzleStatus: PuzzleStatus;
  size: number;
  title: string;
  hintsLimit: number;
}

interface Envelope<T> {
  code: number;
  data: T;
  errorMsg?: string;
  requestId?: string;
}

/** 页面填写优先；未填写时用 VITE_CROSSWORD_CONSOLE_TOKEN */
export function getCrosswordToken() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved !== null) return saved;
  return import.meta.env.VITE_CROSSWORD_CONSOLE_TOKEN || "";
}

export function setCrosswordToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearCrosswordToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const client = axios.create({
  baseURL: "/crossword/console",
  timeout: 20000
});

client.interceptors.request.use(config => {
  config.headers["X-Crossword-Token"] = getCrosswordToken();
  return config;
});

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  let response;
  try {
    response = await client.request<Envelope<T>>(config);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      message(error.response ? "字谜服务返回异常" : "无法连接字谜服务", {
        type: "error"
      });
    }
    throw error;
  }

  const body = response.data;
  if (!body || typeof body.code !== "number") {
    message("字谜服务返回异常", { type: "error" });
    throw new Error("字谜服务返回异常");
  }
  if (body.code !== 200) {
    const msg = body.errorMsg || "请求失败";
    message(msg, { type: "error" });
    throw new Error(msg);
  }
  return body.data;
}

export function listPuzzles(params: {
  status?: PuzzleStatus;
  page?: number;
  pageSize?: number;
}) {
  return request<PuzzleList>({ url: "/puzzles", method: "get", params });
}

export function getPuzzle(id: number) {
  return request<Puzzle>({ url: `/puzzles/${id}`, method: "get" });
}

export function createPuzzle(data: PuzzleWrite) {
  return request<Puzzle>({ url: "/puzzles", method: "post", data });
}

export function updatePuzzle(id: number, data: PuzzleWrite) {
  return request<Puzzle>({ url: `/puzzles/${id}`, method: "put", data });
}

export function deletePuzzle(id: number) {
  return request<{ id: number }>({ url: `/puzzles/${id}`, method: "delete" });
}

export function replaceClues(id: number, clues: ClueWrite[]) {
  return request<Puzzle>({
    url: `/puzzles/${id}/clues`,
    method: "put",
    data: { clues }
  });
}

export function listLevels() {
  return request<Level[]>({ url: "/levels", method: "get" });
}

export function getLevel(level: number) {
  return request<Level>({ url: `/levels/${level}`, method: "get" });
}

export function createLevel(data: LevelWrite) {
  return request<Level>({ url: "/levels", method: "post", data });
}

export function updateLevel(level: number, data: LevelWrite) {
  return request<Level>({ url: `/levels/${level}`, method: "put", data });
}

export function deleteLevel(level: number) {
  return request<{ level: number }>({
    url: `/levels/${level}`,
    method: "delete"
  });
}

export function listDaily(params?: { from?: string; to?: string }) {
  return request<Daily[]>({ url: "/daily", method: "get", params });
}

export function getDaily(date: string) {
  return request<Daily>({ url: `/daily/${date}`, method: "get" });
}

export function createDaily(data: DailyWrite) {
  return request<Daily>({ url: "/daily", method: "post", data });
}

export function updateDaily(date: string, data: DailyWrite) {
  return request<Daily>({ url: `/daily/${date}`, method: "put", data });
}

export function deleteDaily(date: string) {
  return request<{ date: string }>({
    url: `/daily/${date}`,
    method: "delete"
  });
}

/** 下拉选择用，按页拉全（最多 1000 条） */
export async function listPuzzleOptions() {
  const pageSize = 100;
  const first = await listPuzzles({ page: 1, pageSize });
  const all = [...(first.list || [])];
  const pages = Math.min(10, Math.ceil((first.total || 0) / pageSize));
  for (let page = 2; page <= pages; page += 1) {
    const next = await listPuzzles({ page, pageSize });
    all.push(...(next.list || []));
  }
  return all;
}
