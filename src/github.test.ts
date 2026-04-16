import { describe, it, expect, vi } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import {
  getMonthPeriods,
  validateRepoFormat,
  runWithConcurrency,
  withRetry,
  computeJobCosts,
  hasBillableData,
  fetchPrTimings,
} from "./github.js";
import type { RunTiming } from "./billing.js";
import type { WorkflowRun } from "./types.js";

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
    expect(attempts).toBe(3);
    stderrSpy.mockRestore();
  });
});

describe("computeJobCosts", () => {
  it("sums durations by category and computes cost", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest"] },
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["macos-14"] },
    ];
    const { billable, cost } = computeJobCosts(jobs);
    expect(billable.UBUNTU).toBeCloseTo(10);
    expect(billable.MACOS).toBeCloseTo(5);
    expect(billable.WINDOWS).toBe(0);
    expect(billable.SELF_HOSTED).toBe(0);
    expect(cost).toBeCloseTo(10 * 0.008 + 5 * 0.08);
  });

  it("classifies self-hosted jobs separately", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["self-hosted", "linux"] },
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["ubuntu-latest"] },
    ];
    const { billable, cost } = computeJobCosts(jobs);
    expect(billable.SELF_HOSTED).toBeCloseTo(10);
    expect(billable.UBUNTU).toBeCloseTo(5);
    expect(cost).toBeCloseTo(5 * 0.008);
  });

  it("applies custom self-hosted rate", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["self-hosted", "linux"] },
    ];
    const { billable, cost } = computeJobCosts(jobs, 0.01);
    expect(billable.SELF_HOSTED).toBeCloseTo(10);
    expect(cost).toBeCloseTo(10 * 0.01);
  });

  it("applies larger runner rates", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest-16-cores"] },
    ];
    const { billable, cost } = computeJobCosts(jobs);
    expect(billable.UBUNTU).toBeCloseTo(10);
    // 16-core = 8x standard rate
    expect(cost).toBeCloseTo(10 * 0.008 * 8);
  });

  it("skips jobs with null started_at", () => {
    const jobs = [
      { started_at: null, completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest"] },
    ];
    const { billable } = computeJobCosts(jobs);
    expect(billable.UBUNTU).toBe(0);
  });

  it("skips jobs with null completed_at", () => {
    const jobs = [
      { started_at: "2026-01-01T00:00:00Z", completed_at: null, labels: ["ubuntu-latest"] },
    ];
    const { billable } = computeJobCosts(jobs);
    expect(billable.UBUNTU).toBe(0);
  });

  it("skips jobs with zero or negative duration", () => {
    const jobs = [
      { started_at: "2026-01-01T00:10:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["ubuntu-latest"] },
    ];
    const { billable } = computeJobCosts(jobs);
    expect(billable.UBUNTU).toBe(0);
  });

  it("returns zeros for empty job list", () => {
    const { billable, cost } = computeJobCosts([]);
    expect(billable).toEqual({ UBUNTU: 0, MACOS: 0, WINDOWS: 0, SELF_HOSTED: 0 });
    expect(cost).toBe(0);
  });
});

describe("hasBillableData", () => {
  const timing = (u: number, m: number, w: number): RunTiming => ({
    runId: 1, workflow: "CI",
    billable: { UBUNTU: u, MACOS: m, WINDOWS: w, SELF_HOSTED: 0 },
    cost: u * 0.008 + m * 0.08 + w * 0.016,
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

  it("ignores self-hosted minutes for billable detection", () => {
    const t: RunTiming = {
      runId: 1, workflow: "CI",
      billable: { UBUNTU: 0, MACOS: 0, WINDOWS: 0, SELF_HOSTED: 100 },
      cost: 0,
    };
    expect(hasBillableData([t])).toBe(false);
  });
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

describe("fetchPrTimings fallback path", () => {
  const makeRun = (id: number, workflow: string): WorkflowRun => ({
    id,
    repo: "org/repo",
    actor: "user",
    workflow,
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
  });

  it("returns estimated=false when billing API has data", async () => {
    const mockedExecFile = vi.mocked(execFileCb);
    mockedExecFile.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = rest[rest.length - 1] as Function;
      const url = args[1] as string;
      if (url.includes("/timing")) {
        cb(null, { stdout: '{"UBUNTU":60000,"MACOS":0,"WINDOWS":0}\n' });
      }
      return {} as any;
    });

    const result = await fetchPrTimings("org/repo", [makeRun(1, "CI")]);
    expect(result.estimated).toBe(false);
    expect(result.timings).toHaveLength(1);
    expect(result.timings[0].billable.UBUNTU).toBeCloseTo(1);
    expect(result.timings[0].billable.SELF_HOSTED).toBe(0);
    expect(result.timings[0].cost).toBeCloseTo(1 * 0.008);

    mockedExecFile.mockRestore();
  });

  it("falls back to jobs API when billing returns all zeros", async () => {
    const mockedExecFile = vi.mocked(execFileCb);
    mockedExecFile.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = rest[rest.length - 1] as Function;
      const url = args[1] as string;
      if (url.includes("/timing")) {
        cb(null, { stdout: '{"UBUNTU":0,"MACOS":0,"WINDOWS":0}\n' });
      } else if (url.includes("/jobs")) {
        const jobs = [
          { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["ubuntu-latest"] },
          { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["macos-14"] },
        ];
        cb(null, { stdout: JSON.stringify(jobs) + "\n" });
      }
      return {} as any;
    });

    const result = await fetchPrTimings("org/repo", [makeRun(1, "CI")]);
    expect(result.estimated).toBe(true);
    expect(result.timings).toHaveLength(1);
    expect(result.timings[0].billable.UBUNTU).toBeCloseTo(10);
    expect(result.timings[0].billable.MACOS).toBeCloseTo(5);
    expect(result.timings[0].billable.SELF_HOSTED).toBe(0);

    mockedExecFile.mockRestore();
  });

  it("classifies self-hosted jobs in fallback path", async () => {
    const mockedExecFile = vi.mocked(execFileCb);
    mockedExecFile.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = rest[rest.length - 1] as Function;
      const url = args[1] as string;
      if (url.includes("/timing")) {
        cb(null, { stdout: '{"UBUNTU":0,"MACOS":0,"WINDOWS":0}\n' });
      } else if (url.includes("/jobs")) {
        const jobs = [
          { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", labels: ["self-hosted", "linux"] },
          { started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", labels: ["ubuntu-latest"] },
        ];
        cb(null, { stdout: JSON.stringify(jobs) + "\n" });
      }
      return {} as any;
    });

    const result = await fetchPrTimings("org/repo", [makeRun(1, "CI")]);
    expect(result.estimated).toBe(true);
    expect(result.timings[0].billable.SELF_HOSTED).toBeCloseTo(10);
    expect(result.timings[0].billable.UBUNTU).toBeCloseTo(5);
    // self-hosted at $0 + 5min ubuntu at $0.008
    expect(result.timings[0].cost).toBeCloseTo(5 * 0.008);

    mockedExecFile.mockRestore();
  });

  it("collects warnings when jobs API fails", async () => {
    const mockedExecFile = vi.mocked(execFileCb);
    mockedExecFile.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = rest[rest.length - 1] as Function;
      const url = args[1] as string;
      if (url.includes("/timing")) {
        cb(null, { stdout: '{"UBUNTU":0,"MACOS":0,"WINDOWS":0}\n' });
      } else if (url.includes("/jobs")) {
        cb(new Error("API error"), null);
      }
      return {} as any;
    });

    const result = await fetchPrTimings("org/repo", [makeRun(1, "CI")]);
    expect(result.estimated).toBe(true);
    expect(result.timings).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);

    mockedExecFile.mockRestore();
  });
});
