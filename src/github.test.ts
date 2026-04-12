import { describe, it, expect } from "vitest";
import {
  getMonthPeriods,
  validateRepoFormat,
  formatFetchSummary,
  isLargeOrg,
} from "./github.js";
import type { FetchResult } from "./github.js";

describe("getMonthPeriods", () => {
  it("returns a single period for same-month range", () => {
    const periods = getMonthPeriods("2025-03-01", "2025-03-31");
    expect(periods).toEqual([{ start: "2025-03-01", end: "2025-03-31" }]);
  });

  it("splits multi-month range into per-month periods", () => {
    const periods = getMonthPeriods("2025-01-15", "2025-03-10");
    expect(periods).toHaveLength(3);
    expect(periods[0]).toEqual({ start: "2025-01-15", end: "2025-01-31" });
    expect(periods[1]).toEqual({ start: "2025-02-01", end: "2025-02-28" });
    expect(periods[2]).toEqual({ start: "2025-03-01", end: "2025-03-10" });
  });

  it("handles leap year february", () => {
    const periods = getMonthPeriods("2024-02-01", "2024-02-29");
    expect(periods).toEqual([{ start: "2024-02-01", end: "2024-02-29" }]);
  });

  it("handles cross-year ranges", () => {
    const periods = getMonthPeriods("2025-11-01", "2026-02-28");
    expect(periods).toHaveLength(4);
    expect(periods[0].start).toBe("2025-11-01");
    expect(periods[3].end).toBe("2026-02-28");
  });

  it("returns single-day period", () => {
    const periods = getMonthPeriods("2025-06-15", "2025-06-15");
    expect(periods).toEqual([{ start: "2025-06-15", end: "2025-06-15" }]);
  });
});

describe("validateRepoFormat", () => {
  it("accepts valid owner/repo format", () => {
    expect(() => validateRepoFormat("my-org/my-repo")).not.toThrow();
    expect(() => validateRepoFormat("user/repo-name")).not.toThrow();
    expect(() => validateRepoFormat("user123/repo.name")).not.toThrow();
  });

  it("rejects repo without owner", () => {
    expect(() => validateRepoFormat("my-repo")).toThrow(/Invalid repo format/);
  });

  it("rejects empty string", () => {
    expect(() => validateRepoFormat("")).toThrow(/Invalid repo format/);
  });

  it("rejects triple-segment paths", () => {
    expect(() => validateRepoFormat("a/b/c")).toThrow(/Invalid repo format/);
  });

  it("rejects names starting with special characters", () => {
    expect(() => validateRepoFormat(".hidden/repo")).toThrow(/Invalid repo format/);
    expect(() => validateRepoFormat("org/.hidden")).toThrow(/Invalid repo format/);
  });
});

describe("isLargeOrg", () => {
  it("returns false for small counts", () => {
    expect(isLargeOrg(10)).toBe(false);
    expect(isLargeOrg(50)).toBe(false);
  });

  it("returns true above threshold", () => {
    expect(isLargeOrg(51)).toBe(true);
    expect(isLargeOrg(200)).toBe(true);
  });
});

describe("formatFetchSummary", () => {
  const makeResult = (repo: string, count: number): FetchResult => ({
    repo,
    runs: Array.from({ length: count }, (_, i) => ({
      id: i,
      repo,
      actor: "a",
      workflow: "CI",
      startedAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:01:00Z",
    })),
  });

  it("returns empty string when all repos have zero runs", () => {
    expect(formatFetchSummary([makeResult("org/a", 0)])).toBe("");
  });

  it("formats single repo with runs", () => {
    const summary = formatFetchSummary([makeResult("org/api", 42)]);
    expect(summary).toContain("org/api");
    expect(summary).toContain("42 runs");
  });

  it("aligns columns for multiple repos", () => {
    const results = [
      makeResult("org/api", 10),
      makeResult("org/web-frontend", 200),
    ];
    const lines = formatFetchSummary(results).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("org/api");
    expect(lines[1]).toContain("org/web-frontend");
  });

  it("appends skipped repos count", () => {
    const results = [
      makeResult("org/api", 10),
      makeResult("org/docs", 0),
      makeResult("org/legacy", 0),
    ];
    const summary = formatFetchSummary(results);
    expect(summary).toContain("(2 repos with no runs)");
  });

  it("uses singular for one skipped repo", () => {
    const results = [
      makeResult("org/api", 5),
      makeResult("org/docs", 0),
    ];
    expect(formatFetchSummary(results)).toContain("(1 repo with no runs)");
  });
});
