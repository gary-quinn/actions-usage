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

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a user-supplied date string. Returns the validated string.
 * Rejects non-YYYY-MM-DD formats and silently-rolled dates like "2025-02-30".
 */
export function parseDate(input: string): string {
  if (!DATE_FORMAT.test(input)) {
    throw new Error(
      `Invalid date format: "${input}". Expected YYYY-MM-DD (e.g. "2025-01-15")`,
    );
  }
  const date = new Date(input + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${input}"`);
  }
  // Round-trip check catches rolled dates (e.g. Feb 30 → Mar 2)
  if (formatUtcDate(date) !== input) {
    throw new Error(
      `Invalid date: "${input}" — resolved to ${formatUtcDate(date)}`,
    );
  }
  return input;
}

export function validateDateRange(since: string, until: string): void {
  if (since > until) {
    throw new Error(
      `Invalid date range: --since (${since}) is after --until (${until})`,
    );
  }
}
