import { describe, it, expect, vi, afterEach } from "vitest";
import { formatUtcDate, todayStr, startOfMonthStr } from "./dates.js";

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
