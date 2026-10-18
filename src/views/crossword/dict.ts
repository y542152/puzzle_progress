import dayjs from "dayjs";
import type { PuzzleStatus } from "@/api/crossword";

export const STATUS_OPTIONS: {
  value: PuzzleStatus;
  label: string;
  type: "info" | "success" | "warning";
}[] = [
  { value: 0, label: "草稿", type: "info" },
  { value: 1, label: "上架", type: "success" },
  { value: 2, label: "下架", type: "warning" }
];

export const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "简单" },
  { value: "normal", label: "普通" },
  { value: "hard", label: "困难" }
] as const;

export function statusLabel(status: number) {
  return STATUS_OPTIONS.find(item => item.value === status)?.label || "未知";
}

export function statusType(status: number) {
  return STATUS_OPTIONS.find(item => item.value === status)?.type || "info";
}

export function difficultyLabel(value: string) {
  return DIFFICULTY_OPTIONS.find(item => item.value === value)?.label || value;
}

export function formatTime(value?: string) {
  if (!value) return "";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : value;
}
