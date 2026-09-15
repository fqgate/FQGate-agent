import type { DateRangeValue } from "./types";

export const dateRangePresets = [
  { key: "today", label: "当日" },
  { key: "week", label: "近一周" },
  { key: "month", label: "近一月" },
  { key: "quarter", label: "近三月" },
  { key: "year", label: "近一年" }
] as const;

export type DateRangePreset = typeof dateRangePresets[number]["key"];

export function presetDateRange(preset: DateRangePreset, now = new Date()): DateRangeValue {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (preset === "week") {
    start.setDate(start.getDate() - 6);
  } else if (preset !== "today") {
    const months = preset === "month" ? 1 : preset === "quarter" ? 3 : 12;
    const originalDay = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - months);
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    start.setDate(Math.min(originalDay, lastDay));
  }
  return { startDate: formatLocalDate(start), endDate: formatLocalDate(end) };
}

export function selectedDateRangePreset(
  range: DateRangeValue | null | undefined,
  now = new Date()
): DateRangePreset | undefined {
  if (!range) return undefined;
  return dateRangePresets.find(({ key }) => {
    const presetRange = presetDateRange(key, now);
    return presetRange.startDate === range.startDate && presetRange.endDate === range.endDate;
  })?.key;
}

export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
