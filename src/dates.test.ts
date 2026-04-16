import { describe, it, expect, vi, afterEach } from "vitest";
import { formatUtcDate, todayStr, startOfMonthStr, parseDate, validateDateRange } from "./dates.js";

describe("formatUtcDate", () => {
  it("formats a date as YYYY-MM-DD in UTC", () => {
    expect(formatUtcDate(new Date("2026-07-05T00:00:00Z"))).toBe("2026-07-05");
  });

  it("pads single-digit month and day", () => {
    expect(formatUtcDate(new Date("2026-01-03T00:00:00Z"))).toBe("2026-01-03");
  });

  it("uses UTC regardless of timezone offset", () => {
    // 2026-03-31 23:30 in UTC-8 = 2026-04-01 07:30 UTC
    const date = new Date("2026-04-01T07:30:00Z");
    expect(formatUtcDate(date)).toBe("2026-04-01");
  });
});

describe("todayStr / startOfMonthStr", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("todayStr returns UTC date when local date would differ", () => {
    vi.useFakeTimers({ now: new Date("2026-04-01T07:00:00Z") });
    expect(todayStr()).toBe("2026-04-01");
  });

  it("startOfMonthStr returns first day of UTC month", () => {
    vi.useFakeTimers({ now: new Date("2026-04-15T12:00:00Z") });
    expect(startOfMonthStr()).toBe("2026-04-01");
  });

  it("startOfMonthStr uses UTC month boundary", () => {
    vi.useFakeTimers({ now: new Date("2026-04-01T00:30:00Z") });
    expect(startOfMonthStr()).toBe("2026-04-01");
  });
});

describe("parseDate", () => {
  it("accepts valid YYYY-MM-DD", () => {
    expect(parseDate("2025-01-15")).toBe("2025-01-15");
    expect(parseDate("2024-02-29")).toBe("2024-02-29"); // leap year
  });

  it("rejects non-YYYY-MM-DD formats", () => {
    expect(() => parseDate("01-15-2025")).toThrow("Invalid date format");
    expect(() => parseDate("2025/01/15")).toThrow("Invalid date format");
    expect(() => parseDate("banana")).toThrow("Invalid date format");
    expect(() => parseDate("2025-1-5")).toThrow("Invalid date format");
  });

  it("rejects rolled dates", () => {
    expect(() => parseDate("2025-02-30")).toThrow("resolved to 2025-03-02");
    expect(() => parseDate("2025-13-01")).toThrow("Invalid date");
    expect(() => parseDate("2025-04-31")).toThrow("resolved to 2025-05-01");
  });

  it("rejects non-leap-year Feb 29", () => {
    expect(() => parseDate("2025-02-29")).toThrow("resolved to 2025-03-01");
  });
});

describe("validateDateRange", () => {
  it("accepts valid range", () => {
    expect(() => validateDateRange("2025-01-01", "2025-12-31")).not.toThrow();
  });

  it("accepts equal dates", () => {
    expect(() => validateDateRange("2025-06-15", "2025-06-15")).not.toThrow();
  });

  it("rejects since after until", () => {
    expect(() => validateDateRange("2025-12-01", "2025-01-01")).toThrow(
      "Invalid date range",
    );
  });
});
