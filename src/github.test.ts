import { describe, it, expect, vi } from "vitest";
import {
  getMonthPeriods,
  validateRepoFormat,
  runWithConcurrency,
  withRetry,
  labelToOs,
  computeJobMinutes,
  hasBillableData,
} from "./github.js";
import type { RunTiming } from "./billing.js";

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

describe("runWithConcurrency", () => {
  it("returns results in input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return x;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it("propagates errors", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });

  it("returns empty array for empty input", async () => {
    const results = await runWithConcurrency([], 5, async (x) => x);
    expect(results).toEqual([]);
  });

  it("handles concurrency larger than items", async () => {
    const results = await runWithConcurrency([1, 2], 10, async (x) => x * 2);
    expect(results).toEqual([2, 4]);
  });
});

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    let attempts = 0;
    const result = await withRetry(async () => { attempts++; return "ok"; }, 3);
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("retries on rate limit error and logs to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("rate limit exceeded");
      return "ok";
    }, 3);

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    const messages = stderrSpy.mock.calls.map(([c]) => String(c));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("retrying");
    expect(messages[0]).toContain("1/3");
    stderrSpy.mockRestore();
  });

  it("throws non-rate-limit errors immediately without retrying", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("not found");
      }, 3),
    ).rejects.toThrow("not found");
    expect(attempts).toBe(1);
  });

  it("throws after exhausting all retries", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error("429 rate limit");
      }, 2),
    ).rejects.toThrow("429 rate limit");
    // retries=2 → 1 initial + 2 retries = 3 total attempts
    expect(attempts).toBe(3);
    stderrSpy.mockRestore();
  });
});

describe("labelToOs", () => {
  it("maps ubuntu-latest to UBUNTU", () => {
    expect(labelToOs(["ubuntu-latest"])).toBe("UBUNTU");
  });

  it("maps ubuntu-latest-16-cores to UBUNTU", () => {
    expect(labelToOs(["ubuntu-latest-16-cores"])).toBe("UBUNTU");
  });

  it("maps macos-latest to MACOS", () => {
    expect(labelToOs(["macos-latest"])).toBe("MACOS");
  });

  it("maps macos-26 to MACOS", () => {
    expect(labelToOs(["macos-26"])).toBe("MACOS");
  });

  it("maps windows-latest to WINDOWS", () => {
    expect(labelToOs(["windows-latest"])).toBe("WINDOWS");
  });

  it("maps windows-2022 to WINDOWS", () => {
    expect(labelToOs(["windows-2022"])).toBe("WINDOWS");
  });

  it("detects linux in self-hosted labels", () => {
    expect(labelToOs(["self-hosted", "linux", "x64"])).toBe("UBUNTU");
  });

  it("detects windows in self-hosted labels", () => {
    expect(labelToOs(["self-hosted", "windows", "x64"])).toBe("WINDOWS");
  });

  it("detects macOS in self-hosted labels", () => {
    expect(labelToOs(["self-hosted", "macOS", "arm64"])).toBe("MACOS");
  });

  it("does not false-positive on labels containing 'mac' substring", () => {
    // e.g. 'my-macmini-builder' or 'attack-vector' should NOT match MACOS
    expect(labelToOs(["my-macmini-builder"])).toBe("UBUNTU");
    expect(labelToOs(["attack-vector"])).toBe("UBUNTU");
  });

  it("defaults to UBUNTU for unrecognized labels", () => {
    expect(labelToOs(["my-org-runner"])).toBe("UBUNTU");
  });

  it("defaults to UBUNTU for empty labels", () => {
    expect(labelToOs([])).toBe("UBUNTU");
  });

  it("first recognized label wins when multiple OS labels present", () => {
    expect(labelToOs(["linux", "windows"])).toBe("UBUNTU");
    expect(labelToOs(["windows", "linux"])).toBe("WINDOWS");
  });
});

describe("computeJobMinutes", () => {
  it("sums durations by OS from job timestamps", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest"] },
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["macos-14"] },
    ];
    const result = computeJobMinutes(jobs);
    expect(result.UBUNTU).toBeCloseTo(10);
    expect(result.MACOS).toBeCloseTo(5);
    expect(result.WINDOWS).toBe(0);
  });

  it("skips jobs with null started_at", () => {
    const jobs = [
      { started_at: null, completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest"] },
    ];
    const result = computeJobMinutes(jobs);
    expect(result.UBUNTU).toBe(0);
  });

  it("skips jobs with null completed_at", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: null, labels: ["ubuntu-latest"] },
    ];
    const result = computeJobMinutes(jobs);
    expect(result.UBUNTU).toBe(0);
  });

  it("skips jobs with zero or negative duration", () => {
    const jobs = [
      { started_at: "2026-01-01T00:10:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["ubuntu-latest"] },
    ];
    const result = computeJobMinutes(jobs);
    expect(result.UBUNTU).toBe(0);
  });

  it("returns zeros for empty job list", () => {
    const result = computeJobMinutes([]);
    expect(result).toEqual({ UBUNTU: 0, MACOS: 0, WINDOWS: 0 });
  });
});

describe("hasBillableData", () => {
  const timing = (u: number, m: number, w: number): RunTiming => ({
    runId: 1, workflow: "CI", billable: { UBUNTU: u, MACOS: m, WINDOWS: w },
  });

  it("returns false for empty array", () => {
    expect(hasBillableData([])).toBe(false);
  });

  it("returns false when all timings are zero", () => {
    expect(hasBillableData([timing(0, 0, 0), timing(0, 0, 0)])).toBe(false);
  });

  it("returns true when any timing has non-zero billable", () => {
    expect(hasBillableData([timing(0, 0, 0), timing(5, 0, 0)])).toBe(true);
  });

  it("returns true when all timings have non-zero billable", () => {
    expect(hasBillableData([timing(5, 0, 0), timing(0, 3, 0)])).toBe(true);
  });
});
