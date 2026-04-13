/** Format a Date as YYYY-MM-DD using UTC components. */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const todayStr = (): string => formatUtcDate(new Date());

export const startOfMonthStr = (): string => {
  const now = new Date();
  return formatUtcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
};
